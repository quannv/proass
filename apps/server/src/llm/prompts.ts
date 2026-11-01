import { SUGGESTION_TYPE_LABELS, formatClock } from "@proass/shared";
import type { RawSuggestion, TranscriptSegment } from "@proass/shared";
import type { SuggestionContext } from "./LLMProvider";

/** System prompt from CLAUDE.md, used verbatim. */
export const SUGGESTION_SYSTEM_PROMPT =
  "You are ProActive Assistant, a silent, helpful companion listening to a live meeting. Based on the recent transcript and the meeting summary, surface at most 3 high-value, concise insights that help the user understand or contribute right now. Focus on: unfamiliar terms or acronyms, useful background context, claims that may need verification, insightful questions the user could ask, and decisions or action items. Do not repeat items from the 'already shown' list. Do not restate what was just said. If you are not confident a fact is correct, either mark it with low confidence or omit it; never invent numbers, names, or sources. Respond in the same language as the conversation. Output only valid JSON matching the schema.";

/** Appended to the system prompt when the web_search tool is offered. */
export const WEB_SEARCH_GUIDANCE =
  "You can call web_search, but only when a card depends on facts that change over time and you cannot be sure of them: current prices, exchange rates, today's news, recent releases or events, live statistics. Never search for definitions, acronyms, stable facts (laws, history, science) or anything you already know well. Most turns need no search. Search at most once, with a short specific query, then give the JSON answer citing the found figure and its date or source in the body.";

function languageLine(language: string): string {
  return language === "auto"
    ? "Write titles and bodies in the same language as the conversation."
    : `Write titles and bodies in ${language}, even if the conversation uses another language. Keep trigger_quote in the original language.`;
}

/** Diarization labels ("A", "B") read better to the model as "Speaker A". */
function who(speaker?: string): string {
  if (!speaker) return "";
  return speaker.length <= 2 ? ` Speaker ${speaker}:` : ` ${speaker}:`;
}

export function formatTranscript(segments: Pick<TranscriptSegment, "text" | "speaker" | "startMs">[]): string {
  return segments
    .map((s) => `[${formatClock(s.startMs)}]${who(s.speaker)} ${s.text}`)
    .join("\n");
}

export function buildSuggestionPrompt(ctx: SuggestionContext): string {
  const lines = ctx.recent.map((s) => {
    const marker = ctx.newSegmentIds.has(s.id) ? ">> " : "   ";
    return `${marker}[${formatClock(s.startMs)}]${who(s.speaker)} ${s.text}`;
  });
  const shown = ctx.shown.length
    ? ctx.shown.slice(-40).map((s) => `- ${s.type}: ${s.title}`).join("\n")
    : "(none)";
  const types = ctx.enabledTypes.map((t) => `${t} (${SUGGESTION_TYPE_LABELS[t]})`).join(", ");
  return [
    `Meeting summary so far:\n${ctx.summary || "(none yet)"}`,
    `Recent transcript (oldest first; lines starting with ">>" are new since your last look, focus on them):\n${lines.join("\n")}`,
    `Already shown (do not repeat or paraphrase these):\n${shown}`,
    `Allowed types: ${types}.`,
    [
      `Return at most ${ctx.maxItems} suggestions; usually 0 or 1 is right. Return {"suggestions": []} if nothing is genuinely useful.`,
      "Quality bar: would a smart participant be glad to see this card right now? Prefer, in order: correcting a likely-wrong claim, explaining jargon or acronyms a non-specialist may not know, a clearly stated decision or commitment (only when someone explicitly decided or committed), then one sharp question.",
      "Never repeat a topic from the 'already shown' list, even with different wording (e.g. the same action item phrased differently).",
      "Title: max 8 words, sentence case. Body: max 50 words, concrete, no filler.",
      "trigger_quote: a short exact quote copied from the new (>>) lines.",
      "confidence: your honest probability (0-1) that the item is both correct and useful; use below 0.6 when unsure.",
    ].join("\n"),
    languageLine(ctx.outputLanguage),
  ].join("\n\n");
}

export const SUMMARY_UPDATE_SYSTEM_PROMPT =
  "You maintain a running summary of a live meeting so later prompts stay short. Merge the new transcript lines into the previous summary. Keep it under 150 words, factual, and keep names, numbers, decisions and open questions. Output only the summary text.";

export function buildSummaryUpdatePrompt(previous: string, segments: TranscriptSegment[], language: string): string {
  return [
    `Previous summary:\n${previous || "(empty)"}`,
    `New transcript lines:\n${formatTranscript(segments)}`,
    language === "auto" ? "Use the conversation's language." : `Write in ${language}.`,
  ].join("\n\n");
}

export const MEETING_SUMMARY_SYSTEM_PROMPT =
  "You write end-of-meeting notes from a transcript. Produce: a concise summary (max 120 words), the list of decisions actually made, and action items with owner and due date when stated (use an empty string when unknown). Never invent decisions, owners or dates that are not in the transcript. Output only JSON matching the schema.";

export function buildMeetingSummaryPrompt(segments: Pick<TranscriptSegment, "text" | "speaker" | "startMs">[], language: string): string {
  return [
    `Transcript:\n${formatTranscript(segments)}`,
    language === "auto" ? "Write in the same language as the conversation." : `Write in ${language}.`,
  ].join("\n\n");
}

export const EXPLAIN_SYSTEM_PROMPT =
  "You are ProActive Assistant. The user tapped 'tell me more' on an insight you showed during a live meeting. Give a deeper, practical explanation in at most 120 words of plain text (no markdown headings). If you are unsure about a fact, say so; never invent numbers, names, or sources.";

export function buildExplainPrompt(s: Pick<RawSuggestion, "type" | "title" | "body" | "trigger_quote">, context: string, language: string): string {
  return [
    `Insight (${s.type}): ${s.title}\n${s.body}`,
    `Triggered by: "${s.trigger_quote}"`,
    `Recent transcript:\n${context || "(not available)"}`,
    language === "auto" ? "Answer in the same language as the conversation." : `Answer in ${language}.`,
  ].join("\n\n");
}
