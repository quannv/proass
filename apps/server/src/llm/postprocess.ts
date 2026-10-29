import { RawSuggestionSchema, clampWords, quoteCoverage, similarity } from "@proass/shared";
import type { Suggestion, SuggestionType, TranscriptSegment } from "@proass/shared";
import { randomUUID } from "node:crypto";

export interface PostProcessOptions {
  recent: TranscriptSegment[];
  shown: { type: SuggestionType; title: string }[];
  enabledTypes: SuggestionType[];
  minConfidence: number;
  maxItems: number;
}

/**
 * Turns raw LLM items into display-ready suggestions: drops malformed, disabled, low-confidence
 * and duplicate items, clamps lengths, and anchors each item to the transcript line it quotes.
 */
export function postProcess(raw: unknown[], opts: PostProcessOptions): Suggestion[] {
  const accepted: Suggestion[] = [];
  const valid = raw
    .map((item) => RawSuggestionSchema.safeParse(item))
    .flatMap((r) => (r.success ? [r.data] : []))
    .sort((a, b) => b.confidence - a.confidence);
  for (const s of valid) {
    if (!opts.enabledTypes.includes(s.type)) continue;

    // A quote we can't find in the transcript is a hallucination signal: penalize it.
    let best: TranscriptSegment | null = null;
    let bestScore = 0;
    for (const seg of opts.recent) {
      const score = quoteCoverage(s.trigger_quote, seg.text);
      if (score > bestScore) {
        bestScore = score;
        best = seg;
      }
    }
    const confidence = bestScore >= 0.6 ? s.confidence : s.confidence * 0.8;
    if (confidence < opts.minConfidence) continue;

    const isDuplicate = [...opts.shown, ...accepted].some(
      (prev) => similarity(prev.title, s.title) >= 0.6 || (prev.type === s.type && similarity(prev.title, s.title) >= 0.45),
    );
    if (isDuplicate) continue;
    // One card per type per call keeps the panel calm.
    if (accepted.some((prev) => prev.type === s.type)) continue;

    accepted.push({
      id: randomUUID(),
      type: s.type,
      title: clampWords(s.title, 10),
      body: clampWords(s.body, 60),
      triggerQuote: s.trigger_quote,
      confidence,
      segmentId: bestScore >= 0.6 && best ? best.id : null,
      createdAt: Date.now(),
    });
  }
  return accepted.sort((a, b) => b.confidence - a.confidence).slice(0, opts.maxItems);
}
