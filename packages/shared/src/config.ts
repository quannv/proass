import { z } from "zod";
import { SUGGESTION_TYPES, SuggestionTypeSchema } from "./schema";

export const FREQUENCIES = ["low", "medium", "high"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** All knobs that decide when the LLM is called and what gets shown. */
export interface TriggerConfig {
  /** Fire once this many new final words have arrived. */
  minWords: number;
  /** ...or after this much silence, if at least `minWordsOnPause` new words exist. */
  pauseMs: number;
  minWordsOnPause: number;
  /** Coalesce finals that arrive close together. */
  debounceMs: number;
  /** Never call the LLM more often than this. */
  minIntervalMs: number;
  /** Rolling transcript window sent to the LLM. */
  windowMs: number;
  /** How often the running summary is refreshed. */
  summaryIntervalMs: number;
  /** Suggestions below this confidence are dropped. */
  minConfidence: number;
  maxPerCall: number;
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = {
  minWords: 25,
  pauseMs: 2000,
  minWordsOnPause: 8,
  debounceMs: 600,
  minIntervalMs: 9000,
  windowMs: 150_000,
  summaryIntervalMs: 180_000,
  minConfidence: 0.6,
  maxPerCall: 2,
};

export const FREQUENCY_PRESETS: Record<Frequency, Partial<TriggerConfig>> = {
  low: { minWords: 45, minWordsOnPause: 15, minIntervalMs: 20_000, minConfidence: 0.75, maxPerCall: 1 },
  medium: {},
  high: { minWords: 15, minWordsOnPause: 6, minIntervalMs: 6000, minConfidence: 0.5, maxPerCall: 3 },
};

export function resolveTriggerConfig(
  frequency: Frequency,
  overrides: Partial<TriggerConfig> = {},
): TriggerConfig {
  return { ...DEFAULT_TRIGGER_CONFIG, ...FREQUENCY_PRESETS[frequency], ...overrides };
}

/** Languages Muse Voice Transcribe accepts in `languageBias` (from the STT docs). */
export const STT_LANGUAGES = [
  "Arabic", "Bengali", "Dutch", "English", "French", "German", "Hebrew", "Hindi", "Indonesian",
  "Italian", "Japanese", "Kannada", "Korean", "Malay", "Mandarin Chinese", "Marathi", "Polish",
  "Portuguese", "Spanish", "Tagalog", "Tamil", "Telugu", "Thai", "Turkish", "Vietnamese",
] as const;

export const OUTPUT_LANGUAGES = [
  { code: "auto", label: "Same as conversation" },
  { code: "English", label: "English" },
  { code: "Vietnamese", label: "Tiếng Việt" },
  { code: "Spanish", label: "Español" },
  { code: "French", label: "Français" },
  { code: "German", label: "Deutsch" },
  { code: "Portuguese", label: "Português" },
  { code: "Japanese", label: "日本語" },
  { code: "Korean", label: "한국어" },
  { code: "Mandarin Chinese", label: "中文" },
  { code: "Hindi", label: "हिन्दी" },
  { code: "Indonesian", label: "Bahasa Indonesia" },
] as const;

/** Settings the browser sends to the server for a session. */
export const SessionSettingsSchema = z.object({
  frequency: z.enum(FREQUENCIES),
  enabledTypes: z.array(SuggestionTypeSchema).max(SUGGESTION_TYPES.length),
  outputLanguage: z.string().max(40),
  /** Expected spoken languages (STT `languageBias`); empty = let the model detect. */
  spokenLanguages: z.array(z.enum(STT_LANGUAGES)).max(5),
  /** Domain terms the STT might mishear (STT `keywords`). */
  keywords: z.array(z.string().trim().min(1).max(60)).max(100),
  /** Names the user gave diarized speakers, e.g. { "A": "Lan" }, so insights and summaries use real names. */
  speakerNames: z
    .record(z.string().max(8), z.string().trim().min(1).max(40).regex(/^[^\r\n:]+$/))
    .refine((o) => Object.keys(o).length <= 26)
    .optional(),
});
export type SessionSettings = z.infer<typeof SessionSettingsSchema>;

export const DEFAULT_SESSION_SETTINGS: SessionSettings = {
  frequency: "medium",
  enabledTypes: [...SUGGESTION_TYPES],
  outputLanguage: "auto",
  spokenLanguages: [],
  keywords: [],
};
