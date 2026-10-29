import { AUDIO_BYTES_PER_MS, DEMO_LINES, createScriptPlayer } from "@proass/shared";
import type { STTHandlers, STTProvider } from "./STTProvider";

/**
 * Replays the demo meeting script. Its clock is the amount of audio received, so it stays in sync
 * with the demo audio file and pauses naturally when the browser stops sending audio.
 */
export class MockSTTProvider implements STTProvider {
  private handlers: STTHandlers | null = null;
  private player = createScriptPlayer(DEMO_LINES, `mock-${Date.now().toString(36)}`);
  private audioMs: number;

  /** `startAtMs` resumes the script mid-way when the browser reconnects or the meeting resumes. */
  constructor(private readonly startAtMs = 0) {
    this.audioMs = startAtMs;
    this.player.advance(startAtMs); // skip lines that were already delivered
  }

  async start(handlers: STTHandlers): Promise<void> {
    this.handlers = handlers;
  }

  write(chunk: Buffer): void {
    if (!this.handlers) return;
    this.audioMs += chunk.length / AUDIO_BYTES_PER_MS;
    for (const e of this.player.advance(this.audioMs)) {
      if (e.type === "partial") this.handlers.onPartial(e.text, e.speaker);
      else
        this.handlers.onFinal({
          text: e.segment.text,
          speaker: e.segment.speaker,
          startMs: e.segment.startMs - this.startAtMs,
          endMs: e.segment.endMs - this.startAtMs,
        });
    }
  }

  async stop(): Promise<void> {
    this.handlers = null;
  }
}
