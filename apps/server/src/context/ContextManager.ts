import type { ResumeContext, Suggestion, SuggestionType, TranscriptSegment } from "@proass/shared";

const MAX_SEGMENTS = 3000;

/** In-memory meeting context for one connection: transcript, running summary, shown suggestions. */
export class ContextManager {
  private segments: TranscriptSegment[] = [];
  /** Ids already sent to the LLM for suggestions. */
  private seenByLlm = new Set<string>();
  /** Index into `segments` up to which the running summary is current. */
  private summarizedUpTo = 0;
  summary = "";
  readonly shown: { type: SuggestionType; title: string }[] = [];

  constructor(resume?: ResumeContext) {
    if (!resume) return;
    this.segments = [...resume.segments];
    this.segments.forEach((s) => this.seenByLlm.add(s.id));
    this.summary = resume.summary;
    this.summarizedUpTo = resume.summary ? this.segments.length : 0;
    this.shown.push(...resume.shown);
  }

  add(segment: TranscriptSegment): void {
    this.segments.push(segment);
    if (this.segments.length > MAX_SEGMENTS) {
      const drop = this.segments.length - MAX_SEGMENTS;
      this.segments.splice(0, drop);
      this.summarizedUpTo = Math.max(0, this.summarizedUpTo - drop);
    }
  }

  /**
   * Segments within `windowMs` of the latest one, plus anything the running summary doesn't cover yet
   * (so nothing falls into the gap between the window and the summary), capped at 2× the window.
   */
  recent(windowMs: number): TranscriptSegment[] {
    const last = this.segments.at(-1);
    if (!last) return [];
    const from = Math.min(last.endMs - windowMs, Math.max(last.endMs - 2 * windowMs, this.segments[this.summarizedUpTo]?.startMs ?? Infinity));
    return this.segments.filter((s) => s.endMs >= from);
  }

  /** Ids not yet sent to the LLM. Call `markSeen` once a call using them succeeds. */
  newIds(): Set<string> {
    return new Set(this.segments.filter((s) => !this.seenByLlm.has(s.id)).map((s) => s.id));
  }

  markSeen(ids: Iterable<string>): void {
    for (const id of ids) this.seenByLlm.add(id);
  }

  unsummarized(): TranscriptSegment[] {
    return this.segments.slice(this.summarizedUpTo);
  }

  setSummary(summary: string, coveredCount: number): void {
    this.summary = summary;
    this.summarizedUpTo = Math.min(this.segments.length, this.summarizedUpTo + coveredCount);
  }

  markShown(items: Suggestion[]): void {
    for (const s of items) this.shown.push({ type: s.type, title: s.title });
  }
}
