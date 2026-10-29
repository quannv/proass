/** A finalized utterance; times are ms relative to the start of the audio written to this provider. */
export interface SttFinal {
  text: string;
  speaker?: string;
  startMs: number;
  endMs: number;
}

export interface STTHandlers {
  onPartial(text: string, speaker?: string): void;
  onFinal(segment: SttFinal): void;
  /** `fatal` means the provider gave up and the session cannot continue. */
  onError(err: Error, fatal: boolean): void;
}

/**
 * Speech-to-text adapter. The browser streams audio over our WebSocket, so instead of a
 * MediaStream the server-side `start` takes handlers and audio arrives via `write`.
 */
export interface STTProvider {
  start(handlers: STTHandlers): Promise<void>;
  /** Mono PCM16 LE at 24 kHz. */
  write(chunk: Buffer): void;
  stop(): Promise<void>;
}
