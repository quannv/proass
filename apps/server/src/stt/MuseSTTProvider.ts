import WebSocket from "ws";
import { AUDIO_BYTES_PER_MS } from "@proass/shared";
import type { STTHandlers, STTProvider } from "./STTProvider";

export interface MuseSTTOptions {
  apiKey: string;
  url: string;
  model: string;
  mode: "ENDPOINTING" | "DIARIZATION";
  keywords: string[];
  languageBias: string[];
}

/** Muse sessions are capped at 60 minutes; rotate a bit before that. */
const ROTATE_AFTER_MS = 55 * 60 * 1000;
const MAX_BUFFER_MS = 60_000;
const MAX_ATTEMPTS = 6;

/** Per-socket state; old sockets keep delivering finals briefly after a rotation. */
interface Sock {
  ws: WebSocket;
  /** Meeting-audio position (ms) of this socket's first audio byte. */
  offsetMs: number;
  ready: boolean;
  turnStartMs?: number;
  speaker?: string;
}

interface Chunk {
  posMs: number;
  data: Buffer;
}

/**
 * Muse Voice Transcribe realtime client (https://dev.meta.ai/docs/speech-to-text).
 * - Auth goes in the first JSON frame, then raw PCM16 binary frames, then {"type":"endStream"}.
 * - Reconnects with backoff and re-sends audio since the last final, so speech is not lost.
 */
export class MuseSTTProvider implements STTProvider {
  private handlers: STTHandlers | null = null;
  private sock: Sock | null = null;
  /** Audio not yet sent (socket connecting/reconnecting). */
  private pending: Chunk[] = [];
  /** Audio sent on the current socket since its last final (replayed on unexpected reconnect). */
  private sinceFinal: Chunk[] = [];
  private writtenMs = 0;
  private attempts = 0;
  private everReady = false;
  private stopped = false;
  private retryTimer?: NodeJS.Timeout;
  private rotateTimer?: NodeJS.Timeout;

  constructor(private readonly opts: MuseSTTOptions) {}

  start(handlers: STTHandlers): Promise<void> {
    this.handlers = handlers;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Speech service did not respond in time")), 12_000);
      this.connect(0, () => {
        clearTimeout(timeout);
        resolve();
      }, (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  write(chunk: Buffer): void {
    if (this.stopped) return;
    const c: Chunk = { posMs: this.writtenMs, data: chunk };
    this.writtenMs += chunk.length / AUDIO_BYTES_PER_MS;
    if (this.sock?.ready && this.sock.ws.readyState === WebSocket.OPEN) {
      this.sock.ws.send(chunk);
      this.sinceFinal.push(c);
      trim(this.sinceFinal, this.writtenMs);
    } else {
      this.pending.push(c);
      trim(this.pending, this.writtenMs);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    clearTimeout(this.rotateTimer);
    const sock = this.sock;
    if (sock && sock.ws.readyState === WebSocket.OPEN && sock.ready) {
      // endStream lets Muse finalize the current turn; wait briefly for the trailing finals.
      sock.ws.send(JSON.stringify({ type: "endStream" }));
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 4000);
        sock.ws.once("close", () => {
          clearTimeout(t);
          resolve();
        });
      });
    }
    sock?.ws.terminate();
    this.sock = null;
    this.handlers = null;
  }

  private connect(offsetMs: number, onReady?: () => void, onFail?: (err: Error) => void): void {
    const ws = new WebSocket(this.opts.url);
    const sock: Sock = { ws, offsetMs, ready: false };
    this.sock = sock;
    let lastError: string | undefined;

    ws.on("open", () => {
      const handshake: Record<string, unknown> = {
        authorization: { accessToken: `Bearer ${this.opts.apiKey}` },
        audioEncoding: "PCM_24KHZ",
        model: this.opts.model,
        mode: this.opts.mode,
        partialMode: "CUMULATIVE",
        emitAudioProgress: false,
      };
      if (this.opts.keywords.length) handshake.keywords = this.opts.keywords;
      if (this.opts.languageBias.length) handshake.languageBias = this.opts.languageBias;
      ws.send(JSON.stringify(handshake));
    });

    ws.on("message", (data, isBinary) => {
      if (isBinary) return;
      let msg: MuseEvent;
      try {
        msg = JSON.parse(data.toString()) as MuseEvent;
      } catch {
        return;
      }
      // Handshake ack has a sessionId and no type.
      if (!msg.type && msg.sessionId && !sock.ready) {
        sock.ready = true;
        this.everReady = true;
        this.attempts = 0;
        this.flushPending(sock);
        clearTimeout(this.rotateTimer);
        this.rotateTimer = setTimeout(() => this.rotate(), ROTATE_AFTER_MS);
        onReady?.();
        return;
      }
      if (msg.type === "error") lastError = msg.message;
      this.handleEvent(sock, msg);
    });

    ws.on("error", (err) => {
      lastError ??= err.message;
    });

    ws.on("close", (code, reason) => {
      if (sock !== this.sock || this.stopped) return; // rotated-out socket or intentional stop
      const why = lastError || reason.toString() || `code ${code}`;
      if (!sock.ready && !this.everReady && this.attempts >= 1) {
        // Failing before the first ack twice in a row is almost certainly config/auth; don't loop.
        const err = new Error(`Speech service rejected the connection: ${why}`);
        onFail ? onFail(err) : this.handlers?.onError(err, true);
        return;
      }
      this.scheduleReconnect(code, why, onReady, onFail);
    });
  }

  private scheduleReconnect(code: number, why: string, onReady?: () => void, onFail?: (err: Error) => void): void {
    this.attempts++;
    if (this.attempts > MAX_ATTEMPTS) {
      const err = new Error(`Speech service unavailable: ${why}`);
      onFail ? onFail(err) : this.handlers?.onError(err, true);
      return;
    }
    // Re-send everything since the last final so the interrupted utterance is transcribed again.
    this.pending = [...this.sinceFinal, ...this.pending];
    this.sinceFinal = [];
    const offsetMs = this.pending[0]?.posMs ?? this.writtenMs;
    const delay = code === 1013 ? 5000 : Math.min(8000, 400 * 2 ** (this.attempts - 1));
    if (this.everReady) this.handlers?.onError(new Error(`Speech connection lost (${why}); reconnecting…`), false);
    this.retryTimer = setTimeout(() => this.connect(offsetMs, onReady, onFail), delay);
  }

  /** Planned switch to a new Muse session before the 60-minute cap. */
  private rotate(): void {
    const old = this.sock;
    if (!old || this.stopped) return;
    old.ws.send(JSON.stringify({ type: "endStream" })); // old socket finalizes its last turn
    setTimeout(() => old.ws.terminate(), 5000);
    this.sinceFinal = [];
    this.connect(this.writtenMs);
  }

  private flushPending(sock: Sock): void {
    for (const c of this.pending) {
      sock.ws.send(c.data);
      this.sinceFinal.push(c);
    }
    this.pending = [];
  }

  private handleEvent(sock: Sock, msg: MuseEvent): void {
    const h = this.handlers;
    if (!h) return;
    const isCurrent = sock === this.sock;
    switch (msg.type) {
      case "speechStart":
        sock.turnStartMs = msg.audioProcessedMs;
        break;
      case "speaker":
        // Diarization labels arrive just before the turn completes.
        sock.speaker = msg.label;
        break;
      case "transcript": {
        const text = (msg.transcript ?? "").trim();
        if (!msg.final) {
          if (isCurrent && text) h.onPartial(text, undefined);
        } else if (text) {
          this.emitFinal(sock, text, msg.audioProcessedMs);
        }
        break;
      }
      case "speechComplete":
        this.emitFinal(sock, (msg.transcript ?? "").trim(), msg.audioProcessedMs);
        break;
      case "error":
        h.onError(new Error(msg.message || "Speech service error"), false);
        break;
    }
  }

  private emitFinal(sock: Sock, text: string, audioProcessedMs?: number): void {
    const endRel = audioProcessedMs ?? 0;
    const startRel = sock.turnStartMs ?? endRel;
    const endMs = sock.offsetMs + endRel;
    sock.turnStartMs = undefined;
    if (sock === this.sock) {
      // Audio before the end of this turn no longer needs replaying.
      this.sinceFinal = this.sinceFinal.filter((c) => c.posMs + c.data.length / AUDIO_BYTES_PER_MS > endMs);
    }
    if (!/[\p{L}\p{N}]/u.test(text)) return;
    this.handlers?.onFinal({ text, speaker: sock.speaker, startMs: sock.offsetMs + startRel, endMs });
  }
}

interface MuseEvent {
  type?: "transcript" | "speechStart" | "speechEnd" | "speechComplete" | "speaker" | "error";
  sessionId?: string;
  transcript?: string;
  final?: boolean;
  label?: string;
  message?: string;
  audioProcessedMs?: number;
}

function trim(chunks: Chunk[], nowMs: number): void {
  while (chunks.length && chunks[0]!.posMs < nowMs - MAX_BUFFER_MS) chunks.shift();
}
