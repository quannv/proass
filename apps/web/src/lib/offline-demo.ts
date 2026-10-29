import { DEMO_LINES, DEMO_SUGGESTIONS, createScriptPlayer, quoteCoverage } from "@proass/shared";
import type { ScriptEvent, Suggestion, SuggestionType } from "@proass/shared";

export interface OfflineDemoHandlers {
  onEvent(e: ScriptEvent): void;
  onThinking(active: boolean): void;
  onSuggestions(items: Suggestion[]): void;
}

const THINK_AFTER_MS = 900;
const SHOW_AFTER_MS = 2600;

/**
 * Fully in-browser replay of the demo meeting: transcript follows the audio element's clock and
 * pre-recorded suggestions appear after the line that triggers them. Works with no network.
 */
export function startOfflineDemo(
  audio: HTMLAudioElement | undefined,
  enabledTypes: SuggestionType[],
  handlers: OfflineDemoHandlers,
): { stop(): void } {
  const prefix = `offline-${Date.now().toString(36)}`;
  const player = createScriptPlayer(DEMO_LINES, prefix);
  // Anchor each card to the line its quote comes from (not necessarily the line that triggered it).
  const anchor = (quote: string, fallback: number) => {
    const idx = DEMO_LINES.findIndex((l) => quoteCoverage(quote, l.text) >= 0.8);
    return `${prefix}-${idx >= 0 ? idx : fallback}`;
  };
  const startedAt = performance.now();
  const timers: ReturnType<typeof setTimeout>[] = [];
  // If the audio can't play, fall back to a wall clock so the demo still runs.
  const now = () => (audio && !audio.error && audio.currentTime > 0 ? audio.currentTime * 1000 : performance.now() - startedAt);

  const tick = setInterval(() => {
    for (const e of player.advance(now())) {
      handlers.onEvent(e);
      if (e.type !== "final") continue;
      const items = DEMO_SUGGESTIONS.filter((s) => s.afterLine === e.lineIndex && enabledTypes.includes(s.type));
      if (!items.length) continue;
      timers.push(setTimeout(() => handlers.onThinking(true), THINK_AFTER_MS));
      timers.push(
        setTimeout(() => {
          handlers.onThinking(false);
          handlers.onSuggestions(
            items.map((s, i) => ({
              id: `${e.segment.id}-s${i}`,
              type: s.type,
              title: s.title,
              body: s.body,
              triggerQuote: s.trigger_quote,
              confidence: s.confidence,
              segmentId: anchor(s.trigger_quote, e.lineIndex),
              createdAt: Date.now(),
            })),
          );
        }, SHOW_AFTER_MS),
      );
    }
  }, 100);

  return {
    stop() {
      clearInterval(tick);
      timers.forEach(clearTimeout);
      handlers.onThinking(false);
    },
  };
}
