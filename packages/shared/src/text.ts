/** Small text helpers shared by the server (filtering) and the browser (offline demo, export). */

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

export function countWords(text: string): number {
  return tokenize(text).length;
}

/** Jaccard similarity of the token sets, 0..1. */
export function similarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** Fraction of the quote's tokens that appear in `text`, 0..1. */
export function quoteCoverage(quote: string, text: string): number {
  const q = tokenize(quote);
  if (q.length === 0) return 0;
  const t = new Set(tokenize(text));
  return q.filter((w) => t.has(w)).length / q.length;
}

/** Truncate to `max` words, adding an ellipsis when cut. */
export function clampWords(text: string, max: number): string {
  const words = text.trim().split(/\s+/);
  if (words.length <= max) return text.trim();
  return `${words.slice(0, max).join(" ")}…`;
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
