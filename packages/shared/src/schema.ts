import { z } from "zod";

export const SUGGESTION_TYPES = [
  "definition",
  "background",
  "fact_check",
  "question_to_ask",
  "action_item",
  "decision",
  "related_idea",
] as const;

export const SuggestionTypeSchema = z.enum(SUGGESTION_TYPES);
export type SuggestionType = z.infer<typeof SuggestionTypeSchema>;

/** One item exactly as the LLM returns it (schema from CLAUDE.md). Limits are lenient; we clamp later. */
export const RawSuggestionSchema = z.object({
  type: SuggestionTypeSchema,
  title: z.string().trim().min(1).max(160),
  body: z.string().trim().min(1).max(800),
  trigger_quote: z.string().trim().max(500),
  confidence: z.number().min(0).max(1),
});
export type RawSuggestion = z.infer<typeof RawSuggestionSchema>;

/** Envelope only; items are validated one by one so a single bad item doesn't drop the batch. */
export const RawSuggestionEnvelopeSchema = z.object({ suggestions: z.array(z.unknown()) });

/** A suggestion as sent to the browser. */
export interface Suggestion {
  id: string;
  type: SuggestionType;
  title: string;
  body: string;
  triggerQuote: string;
  confidence: number;
  /** Transcript segment the quote was found in, if any (for click-to-scroll). */
  segmentId: string | null;
  createdAt: number;
}

export const TranscriptSegmentSchema = z.object({
  id: z.string().max(64),
  text: z.string().max(5000),
  speaker: z.string().max(40).optional(),
  /** Milliseconds since the meeting started. */
  startMs: z.number().nonnegative(),
  endMs: z.number().nonnegative(),
});
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;

export const ActionItemSchema = z.object({
  task: z.string(),
  owner: z.string(),
  due: z.string(),
});
export const MeetingSummarySchema = z.object({
  summary: z.string(),
  decisions: z.array(z.string()),
  action_items: z.array(ActionItemSchema),
});
export type MeetingSummary = z.infer<typeof MeetingSummarySchema>;

/** JSON Schema for Muse structured output (strict mode: no oneOf/allOf, additionalProperties false). */
export const SUGGESTIONS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "title", "body", "trigger_quote", "confidence"],
        properties: {
          type: { type: "string", enum: [...SUGGESTION_TYPES] },
          title: { type: "string", description: "max 8 words" },
          body: { type: "string", description: "max 50 words" },
          trigger_quote: { type: "string", description: "short exact quote from the transcript" },
          confidence: { type: "number", description: "0.0 to 1.0" },
        },
      },
    },
  },
} as const;

export const MEETING_SUMMARY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "decisions", "action_items"],
  properties: {
    summary: { type: "string" },
    decisions: { type: "array", items: { type: "string" } },
    action_items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["task", "owner", "due"],
        properties: {
          task: { type: "string" },
          owner: { type: "string", description: "empty string if unknown" },
          due: { type: "string", description: "empty string if unknown" },
        },
      },
    },
  },
} as const;

export const SUGGESTION_TYPE_LABELS: Record<SuggestionType, string> = {
  definition: "Definition",
  background: "Background",
  fact_check: "Fact check",
  question_to_ask: "Question to ask",
  action_item: "Action item",
  decision: "Decision",
  related_idea: "Related idea",
};
