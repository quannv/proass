import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import { ClientMessageSchema, countWords, resolveTriggerConfig } from "@proass/shared";
import type { ClientMessage, ServerMessage, SessionSettings, TriggerConfig } from "@proass/shared";
import { config, providerInfo } from "./config";
import { ContextManager } from "./context/ContextManager";
import { llm } from "./llm";
import { postProcess } from "./llm/postprocess";
import { createSTTProvider } from "./stt";
import type { STTProvider, SttFinal } from "./stt";
import { TriggerEngine } from "./trigger/TriggerEngine";

/** Close code telling the browser not to auto-reconnect (needs user action, e.g. Retry). */
export const CLOSE_FATAL = 4001;

/**
 * One browser connection: audio in → STT → context → trigger → LLM → suggestions out.
 * Nothing is persisted; everything is dropped when the socket closes.
 */
export class Session {
  readonly id = randomUUID().slice(0, 8);
  private settings!: SessionSettings;
  private stt: STTProvider | null = null;
  private ctx = new ContextManager();
  private trigger: TriggerEngine | null = null;
  private offsetMs = 0;
  private segCounter = 0;
  private started = false;
  private closed = false;
  private summaryTimer?: NodeJS.Timeout;
  private summaryInflight: AbortController | null = null;

  constructor(private readonly ws: WebSocket) {
    ws.on("message", (data, isBinary) => {
      if (isBinary) this.stt?.write(data as Buffer);
      else this.onControl(data.toString());
    });
    ws.on("close", () => void this.dispose());
    log(this.id, "connected");
  }

  private onControl(raw: string): void {
    let msg: ClientMessage;
    try {
      const parsed = ClientMessageSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) return this.send({ type: "error", message: "Invalid message", retryable: false });
      msg = parsed.data;
    } catch {
      return;
    }
    if (msg.type === "start") void this.start(msg);
    else if (msg.type === "settings") this.settings = msg.settings;
    else if (msg.type === "stop") void this.stop();
  }

  private async start(msg: Extract<ClientMessage, { type: "start" }>): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.settings = msg.settings;
    this.offsetMs = msg.resume.elapsedMs;
    this.ctx = new ContextManager(msg.resume);
    this.trigger = new TriggerEngine(() => this.triggerConfig(), (signal) => this.suggest(signal));
    const stt = createSTTProvider(msg.settings, msg.resume.elapsedMs);
    this.stt = stt;
    try {
      await stt.start({
        onPartial: (text, speaker) => {
          this.send({ type: "partial", text, speaker });
          this.trigger?.onPartial();
        },
        onFinal: (f) => this.onFinal(f),
        onError: (err, fatal) => {
          log(this.id, `stt error (fatal=${fatal}): ${err.message}`);
          this.send({ type: "error", message: err.message, retryable: true });
          if (fatal) this.ws.close(CLOSE_FATAL, "stt_failed");
        },
      });
    } catch (err) {
      log(this.id, `stt start failed: ${(err as Error).message}`);
      this.send({ type: "error", message: (err as Error).message, retryable: true });
      this.ws.close(CLOSE_FATAL, "stt_failed");
      return;
    }
    if (this.closed) return;
    this.send({ type: "ready", sessionId: this.id, providers: providerInfo });
    this.summaryTimer = setInterval(() => void this.refreshSummary(), this.triggerConfig().summaryIntervalMs);
    log(this.id, `started (stt=${config.sttProvider}, llm=${config.llmProvider}, offset=${Math.round(this.offsetMs)}ms)`);
  }

  private onFinal(f: SttFinal): void {
    const segment = {
      id: `${this.id}-${this.segCounter++}`,
      text: f.text,
      speaker: f.speaker,
      startMs: Math.round(this.offsetMs + f.startMs),
      endMs: Math.round(this.offsetMs + f.endMs),
    };
    this.ctx.add(segment);
    this.send({ type: "final", segment });
    this.trigger?.onFinal(countWords(f.text));
  }

  private async suggest(signal: AbortSignal): Promise<void> {
    const cfg = this.triggerConfig();
    const newSegmentIds = this.ctx.takeNewIds();
    if (newSegmentIds.size === 0) return;
    const recent = this.ctx.recent(cfg.windowMs);
    const started = Date.now();
    this.send({ type: "thinking", active: true });
    try {
      const raw = await llm.generateSuggestions(
        {
          summary: this.ctx.summary,
          recent,
          newSegmentIds,
          shown: this.ctx.shown,
          enabledTypes: this.settings.enabledTypes,
          outputLanguage: this.settings.outputLanguage,
          maxItems: cfg.maxPerCall,
        },
        signal,
      );
      if (signal.aborted || this.closed) return;
      const items = postProcess(raw, {
        recent,
        shown: this.ctx.shown,
        enabledTypes: this.settings.enabledTypes,
        minConfidence: cfg.minConfidence,
        maxItems: cfg.maxPerCall,
      });
      log(this.id, `suggest: ${raw.length} raw → ${items.length} shown in ${Date.now() - started}ms`);
      if (items.length) {
        this.ctx.markShown(items);
        this.send({ type: "suggestions", items });
      }
    } catch (err) {
      if (signal.aborted || this.closed) return;
      log(this.id, `suggest failed: ${(err as Error).message}`);
      this.send({ type: "error", message: "Couldn't fetch suggestions this time; will retry on the next topic.", retryable: false });
    } finally {
      if (!signal.aborted) this.send({ type: "thinking", active: false });
    }
  }

  private async refreshSummary(): Promise<void> {
    if (this.summaryInflight) return;
    const segments = this.ctx.unsummarized();
    if (segments.length < 3) return;
    const controller = new AbortController();
    this.summaryInflight = controller;
    try {
      const summary = await llm.updateSummary(this.ctx.summary, segments, this.settings.outputLanguage, controller.signal);
      if (this.closed) return;
      this.ctx.setSummary(summary, segments.length);
      this.send({ type: "summary_update", summary });
    } catch (err) {
      if (!controller.signal.aborted) log(this.id, `summary update failed: ${(err as Error).message}`);
    } finally {
      this.summaryInflight = null;
    }
  }

  private async stop(): Promise<void> {
    await this.stt?.stop(); // flushes trailing finals before we report "ended"
    this.stt = null;
    this.send({ type: "ended" });
    this.ws.close(1000, "stopped");
  }

  private async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.trigger?.dispose();
    clearInterval(this.summaryTimer);
    this.summaryInflight?.abort();
    await this.stt?.stop().catch(() => {});
    this.stt = null;
    log(this.id, "closed");
  }

  private triggerConfig(): TriggerConfig {
    return resolveTriggerConfig(this.settings.frequency, config.triggerOverrides);
  }

  private send(msg: ServerMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

/** Logs metadata only; transcript content never goes to logs. */
export function log(id: string, msg: string): void {
  console.log(`${new Date().toISOString()} [${id}] ${msg}`);
}
