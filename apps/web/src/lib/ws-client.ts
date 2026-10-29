import { AUDIO_BYTES_PER_MS } from "@proass/shared";
import type { ClientMessage, ServerMessage } from "@proass/shared";

/** Must match CLOSE_FATAL in apps/server/src/session.ts. */
const CLOSE_FATAL = 4001;
const MAX_QUEUE_MS = 30_000;
const MAX_ATTEMPTS = 10;

export type LinkState = "connecting" | "open" | "reconnecting" | "closed";

export interface WsClientOptions {
  /** Resolves the `wss://…/ws?token=…` URL; `reconnecting` asks for a brand-new token (the server may have restarted). */
  getUrl: (reconnecting: boolean) => Promise<string>;
  /** Builds the `start` message; `elapsedMs` = meeting time of the first audio byte on this connection. */
  buildStart: (elapsedMs: number) => ClientMessage;
  /** Meeting time (ms) where this run's audio begins (non-zero when resuming a paused meeting). */
  startOffsetMs: number;
  onMessage: (msg: ServerMessage) => void;
  onState: (state: LinkState) => void;
  /** Connection lost for good (needs a user Retry). */
  onFatal: (message: string) => void;
}

/**
 * WebSocket to our server with auto-reconnect. Audio produced while disconnected is queued
 * (up to 30 s) and flushed after the new session is started, so nothing said is dropped.
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private queue: ArrayBuffer[] = [];
  private queuedMs = 0;
  private sentMs: number;
  private attempts = 0;
  private stopping = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private endedResolve?: () => void;

  constructor(private readonly opts: WsClientOptions) {
    this.sentMs = opts.startOffsetMs;
  }

  connect(): void {
    this.opts.onState(this.attempts === 0 ? "connecting" : "reconnecting");
    void this.open();
  }

  sendAudio(pcm: ArrayBuffer): void {
    if (this.stopping) return;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(pcm);
      this.sentMs += pcm.byteLength / AUDIO_BYTES_PER_MS;
    } else {
      this.queue.push(pcm);
      this.queuedMs += pcm.byteLength / AUDIO_BYTES_PER_MS;
      while (this.queuedMs > MAX_QUEUE_MS && this.queue.length) {
        const dropped = this.queue.shift()!;
        this.queuedMs -= dropped.byteLength / AUDIO_BYTES_PER_MS;
        this.sentMs += dropped.byteLength / AUDIO_BYTES_PER_MS; // keep the timeline aligned
      }
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Asks the server to flush the last finals, then closes. */
  async stop(): Promise<void> {
    this.stopping = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "stop" } satisfies ClientMessage));
      await new Promise<void>((resolve) => {
        this.endedResolve = resolve;
        setTimeout(resolve, 5000);
      });
    }
    ws?.close(1000);
    this.ws = null;
    this.opts.onState("closed");
  }

  /** Meeting time covered by audio handed to the server (including queued audio). */
  get audioMs(): number {
    return this.sentMs + this.queuedMs;
  }

  private async open(): Promise<void> {
    let url: string;
    try {
      url = await this.opts.getUrl(this.attempts > 0);
    } catch (err) {
      return this.retry((err as Error).message);
    }
    if (this.stopping) return;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    this.ws = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify(this.opts.buildStart(this.sentMs)));
      for (const chunk of this.queue) {
        ws.send(chunk);
        this.sentMs += chunk.byteLength / AUDIO_BYTES_PER_MS;
      }
      this.queue = [];
      this.queuedMs = 0;
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === "ready") {
        this.attempts = 0;
        this.opts.onState("open");
      }
      if (msg.type === "ended") this.endedResolve?.();
      this.opts.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (ws !== this.ws || this.stopping) return;
      this.ws = null;
      if (ev.code === CLOSE_FATAL) {
        this.opts.onState("closed");
        this.opts.onFatal(ev.reason === "stt_failed" ? "The speech service is unavailable." : "Connection closed by server.");
        return;
      }
      this.retry(ev.code === 1006 ? "Connection lost" : `Connection closed (${ev.code})`);
    };
  }

  private retry(reason: string): void {
    if (this.stopping) return;
    this.attempts++;
    if (this.attempts > MAX_ATTEMPTS) {
      this.opts.onState("closed");
      this.opts.onFatal(`${reason}. Gave up after ${MAX_ATTEMPTS} attempts.`);
      return;
    }
    this.opts.onState("reconnecting");
    const delay = Math.min(8000, 500 * 2 ** (this.attempts - 1));
    this.retryTimer = setTimeout(() => void this.open(), delay);
  }
}
