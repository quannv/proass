import meeting from "./meeting.json";
import timeline from "./timeline.json";
import type { MeetingSummary, SuggestionType, TranscriptSegment } from "../schema";

export interface DemoLine {
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface DemoSuggestion {
  afterLine: number;
  type: SuggestionType;
  title: string;
  body: string;
  trigger_quote: string;
  confidence: number;
  /** Pre-written "tell me more" text for offline demo. */
  more: string;
}

export const DEMO_TITLE: string = meeting.title;
export const DEMO_DURATION_MS: number = timeline.durationMs;
export const DEMO_LINES: DemoLine[] = timeline.lines;
export const DEMO_SUGGESTIONS = meeting.suggestions as DemoSuggestion[];
export const DEMO_SUMMARY: MeetingSummary = meeting.summary;
/** STT keyword hints for the demo meeting's jargon. */
export const DEMO_KEYWORDS = ["SOC 2", "p95", "RAG", "re-ranker", "GDPR", "DPA", "NRR", "design partner"];
export const DEMO_AUDIO_URL = "/demo/meeting.m4a";

export type ScriptEvent =
  | { type: "partial"; text: string; speaker: string }
  | { type: "final"; segment: TranscriptSegment; lineIndex: number };

/**
 * Replays scripted lines against a clock you drive (`advance(nowMs)`), emitting word-by-word
 * partials and a final per line. Used by MockSTTProvider (clock = audio received) and the
 * offline demo (clock = audio element time).
 */
export function createScriptPlayer(lines: DemoLine[], idPrefix: string, finalDelayMs = 350) {
  let next = 0;
  let lastPartial = "";
  return {
    advance(nowMs: number): ScriptEvent[] {
      const events: ScriptEvent[] = [];
      while (next < lines.length) {
        const line = lines[next]!;
        if (nowMs >= line.endMs + finalDelayMs) {
          events.push({
            type: "final",
            lineIndex: next,
            segment: { id: `${idPrefix}-${next}`, text: line.text, speaker: line.speaker, startMs: line.startMs, endMs: line.endMs },
          });
          next++;
          lastPartial = "";
          continue;
        }
        if (nowMs >= line.startMs) {
          const words = line.text.split(/\s+/);
          const progress = Math.min(1, (nowMs - line.startMs) / Math.max(1, line.endMs - line.startMs));
          const text = words.slice(0, Math.max(1, Math.ceil(words.length * progress))).join(" ");
          if (text !== lastPartial) {
            lastPartial = text;
            events.push({ type: "partial", text, speaker: line.speaker });
          }
        }
        break;
      }
      return events;
    },
    get done() {
      return next >= lines.length;
    },
  };
}
