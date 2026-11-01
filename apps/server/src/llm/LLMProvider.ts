import type { MeetingSummary, RawSuggestion, SuggestionType, TranscriptSegment } from "@proass/shared";

export interface SuggestionContext {
  summary: string;
  /** Rolling window, oldest first. */
  recent: TranscriptSegment[];
  /** Segment ids that arrived since the previous LLM call (the part to focus on). */
  newSegmentIds: Set<string>;
  shown: { type: SuggestionType; title: string }[];
  enabledTypes: SuggestionType[];
  outputLanguage: string;
  maxItems: number;
  /** Called when the model runs a web search (lets the UI show what it is looking up). */
  onSearch?: (query: string) => void;
}

export interface LLMProvider {
  /** Returns raw items; validation and filtering happen in postprocess.ts. */
  generateSuggestions(ctx: SuggestionContext, signal: AbortSignal): Promise<unknown[]>;
  /** Folds new transcript lines into the running summary. */
  updateSummary(previous: string, segments: TranscriptSegment[], language: string, signal: AbortSignal): Promise<string>;
  summarizeMeeting(segments: Pick<TranscriptSegment, "text" | "speaker" | "startMs">[], language: string, signal: AbortSignal): Promise<MeetingSummary>;
  explain(suggestion: Pick<RawSuggestion, "type" | "title" | "body" | "trigger_quote">, context: string, language: string, signal: AbortSignal): Promise<string>;
}
