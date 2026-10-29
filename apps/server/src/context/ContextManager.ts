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

  /** Segments within `windowMs` of the latest one. */
  recent(windowMs: number): TranscriptSegment[] {
    const last = this.segments.at(-1);
    if (!last) return [];
    return this.segments.filter((s) => s.endMs >= last.endMs - windowMs);
  }

  /** Marks the current recent window as seen and returns the ids that were new. */
  takeNewIds(): Set<string> {
    const ids = new Set<string>();
    for (const s of this.segments) {
      if (!this.seenByLlm.has(s.id)) {
        ids.add(s.id);
        this.seenByLlm.add(s.id);
      }
    }
    return ids;
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
