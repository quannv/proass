import type { TriggerConfig } from "@proass/shared";

/**
 * Decides when to call the LLM:
 *  - after `minWords` new final words (debounced), or
 *  - after `pauseMs` of silence if at least `minWordsOnPause` new words exist,
 *  - never more often than `minIntervalMs`,
 *  - never two calls at once: words that arrive during a call wait for it to finish
 *    (aborting it instead would starve long stretches of speech when calls outlast the interval).
 *  - dispose() aborts the in-flight call.
 */
export class TriggerEngine {
  private pendingWords = 0;
  private lastFireAt = -Infinity;
  private fireTimer?: NodeJS.Timeout;
  private pauseTimer?: NodeJS.Timeout;
  private inflight: AbortController | null = null;
  /** A trigger fired while a call was in flight; run again once it settles. */
  private rerun = false;
  private disposed = false;

  constructor(
    private readonly getConfig: () => TriggerConfig,
    private readonly fire: (signal: AbortSignal) => Promise<void>,
    private readonly now: () => number = Date.now,
  ) {}

  onFinal(words: number): void {
    if (this.disposed) return;
    this.pendingWords += words;
    const cfg = this.getConfig();
    clearTimeout(this.pauseTimer);
    if (this.pendingWords >= cfg.minWords) {
      this.schedule(cfg.debounceMs);
    } else if (this.pendingWords >= cfg.minWordsOnPause) {
      this.pauseTimer = setTimeout(() => this.schedule(0), cfg.pauseMs);
    }
  }

  /** Someone is still talking: push back the "natural pause" timer. */
  onPartial(): void {
    if (this.disposed || !this.pauseTimer) return;
    const cfg = this.getConfig();
    clearTimeout(this.pauseTimer);
    if (this.pendingWords >= cfg.minWordsOnPause) {
      this.pauseTimer = setTimeout(() => this.schedule(0), cfg.pauseMs);
    }
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.fireTimer);
    clearTimeout(this.pauseTimer);
    this.inflight?.abort();
  }

  private schedule(delayMs: number): void {
    const cfg = this.getConfig();
    const wait = Math.max(delayMs, this.lastFireAt + cfg.minIntervalMs - this.now());
    clearTimeout(this.fireTimer);
    this.fireTimer = setTimeout(() => void this.run(), wait);
  }

  private async run(): Promise<void> {
    if (this.disposed || this.pendingWords === 0) return;
    if (this.inflight) {
      this.rerun = true;
      return;
    }
    clearTimeout(this.pauseTimer);
    const controller = new AbortController();
    this.inflight = controller;
    this.pendingWords = 0;
    this.lastFireAt = this.now();
    try {
      await this.fire(controller.signal);
    } finally {
      this.inflight = null;
      if (this.rerun && !this.disposed) {
        this.rerun = false;
        this.schedule(0);
      }
    }
  }
}
