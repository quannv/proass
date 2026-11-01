import { z } from "zod";
import { SessionSettingsSchema } from "./config";
import { SuggestionTypeSchema, TranscriptSegmentSchema } from "./schema";
import type { MeetingSummary, Suggestion, TranscriptSegment } from "./schema";

/** Audio format on the browser → server WebSocket: binary frames of mono PCM16 little-endian. */
export const AUDIO_SAMPLE_RATE = 24_000;
export const AUDIO_BYTES_PER_MS = (AUDIO_SAMPLE_RATE * 2) / 1000;

/** Sent on (re)connect so a fresh server session can continue where the last one stopped. */
export const ResumeContextSchema = z.object({
  /** Meeting time (ms) at which the first audio byte of this connection starts. */
  elapsedMs: z.number().nonnegative(),
  segments: z.array(TranscriptSegmentSchema).max(400),
  summary: z.string().max(10_000),
  shown: z
    .array(z.object({ type: SuggestionTypeSchema, title: z.string().max(200) }))
    .max(300),
});
export type ResumeContext = z.infer<typeof ResumeContextSchema>;

export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("start"), settings: SessionSettingsSchema, resume: ResumeContextSchema }),
  z.object({ type: z.literal("settings"), settings: SessionSettingsSchema }),
  z.object({ type: z.literal("stop") }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ProviderKind = "muse" | "mock";
export interface ProviderInfo {
  stt: ProviderKind;
  llm: ProviderKind;
  /** LLM model id from MUSE_LLM_MODEL, e.g. "muse-wonder-1.0" (only when llm is "muse"). */
  llmModel?: string;
}

/** "muse-wonder-1.0" → "Muse Wonder", "muse-spark-1.3-contributor" → "Muse Spark". */
export function modelLabel(id: string): string {
  const m = /^muse-([a-z]+)/.exec(id);
  return m ? `Muse ${m[1]!.charAt(0).toUpperCase()}${m[1]!.slice(1)}` : id;
}

export type ServerMessage =
  | { type: "ready"; sessionId: string; providers: ProviderInfo }
  | { type: "partial"; text: string; speaker?: string }
  | { type: "final"; segment: TranscriptSegment }
  | { type: "thinking"; active: boolean }
  /** The model is running a web search for this insight call (cleared by thinking: false). */
  | { type: "searching"; query: string }
  | { type: "suggestions"; items: Suggestion[] }
  | { type: "summary_update"; summary: string }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "ended" };

/** HTTP API payloads. */
export interface SessionTokenResponse {
  token: string;
  expiresAt: number;
  providers: ProviderInfo;
}

export const ExplainRequestSchema = z.object({
  suggestion: z.object({
    type: SuggestionTypeSchema,
    title: z.string().max(200),
    body: z.string().max(1000),
    triggerQuote: z.string().max(500),
  }),
  context: z.string().max(20_000),
  language: z.string().max(40),
});
export type ExplainRequest = z.infer<typeof ExplainRequestSchema>;
export interface ExplainResponse {
  text: string;
}

export const SummaryRequestSchema = z.object({
  segments: z
    .array(z.object({ text: z.string().max(5000), speaker: z.string().max(40).optional(), startMs: z.number() }))
    .max(20_000),
  language: z.string().max(40),
});
export type SummaryRequest = z.infer<typeof SummaryRequestSchema>;
export type SummaryResponse = MeetingSummary;
