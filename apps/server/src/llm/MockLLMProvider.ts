import { DEMO_SUGGESTIONS, DEMO_SUMMARY, quoteCoverage, similarity } from "@proass/shared";
import type { MeetingSummary, RawSuggestion, TranscriptSegment } from "@proass/shared";
import type { LLMProvider, SuggestionContext } from "./LLMProvider";

const GLOSSARY: Record<string, string> = {
  API: "Application Programming Interface: a defined way for software components to talk to each other.",
  SLA: "Service Level Agreement: a contractual commitment on uptime, latency or support response times.",
  KPI: "Key Performance Indicator: a metric used to track progress toward a goal.",
  OKR: "Objectives and Key Results: a goal-setting framework pairing a qualitative objective with measurable results.",
  ROI: "Return on Investment: gain relative to cost, usually expressed as a percentage.",
  MVP: "Minimum Viable Product: the smallest version of a product that lets you learn from real users.",
  ARR: "Annual Recurring Revenue: yearly value of subscription revenue.",
  LLM: "Large Language Model: an AI model trained on large text corpora to understand and generate language.",
};

const DECISION = /\b(we decided|decision|let's go with|we go with|we will go with|agreed to)\b|quyết định/i;
const ACTION = /\b(i will|i'll|can you|please own|by (monday|tuesday|wednesday|thursday|friday|next week|tomorrow))\b|sẽ làm|hạn chót/i;

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

/** Deterministic stand-in for the Muse LLM: knows the demo meeting plus a few generic heuristics. */
export class MockLLMProvider implements LLMProvider {
  async generateSuggestions(ctx: SuggestionContext, signal: AbortSignal): Promise<unknown[]> {
    await sleep(700 + Math.random() * 700, signal);
    const fresh = ctx.recent.filter((s) => ctx.newSegmentIds.has(s.id));
    const out: RawSuggestion[] = [];

    for (const d of DEMO_SUGGESTIONS) {
      if (fresh.some((s) => quoteCoverage(d.trigger_quote, s.text) >= 0.8)) {
        out.push({ type: d.type, title: d.title, body: d.body, trigger_quote: d.trigger_quote, confidence: d.confidence });
      }
    }
    for (const seg of fresh) {
      if (out.some((o) => quoteCoverage(o.trigger_quote, seg.text) >= 0.8)) continue;
      const quote = seg.text.split(/\s+/).slice(0, 10).join(" ");
      if (DECISION.test(seg.text)) {
        out.push({ type: "decision", title: "Decision noted", body: seg.text, trigger_quote: quote, confidence: 0.7 });
      } else if (ACTION.test(seg.text)) {
        out.push({ type: "action_item", title: `Follow-up${seg.speaker ? ` for ${seg.speaker}` : ""}`, body: seg.text, trigger_quote: quote, confidence: 0.65 });
      }
      for (const [term, def] of Object.entries(GLOSSARY)) {
        if (new RegExp(`\\b${term}\\b`).test(seg.text)) {
          out.push({ type: "definition", title: `What ${term} means`, body: def, trigger_quote: term, confidence: 0.8 });
        }
      }
    }
    return out.slice(0, ctx.maxItems + 2);
  }

  async updateSummary(previous: string, segments: TranscriptSegment[], _language: string, signal: AbortSignal): Promise<string> {
    await sleep(300, signal);
    const gist = segments.slice(-4).map((s) => s.text.split(/\s+/).slice(0, 14).join(" ")).join(" … ");
    return `${previous ? `${previous}\n` : ""}Discussed: ${gist}`.slice(-1500);
  }

  async summarizeMeeting(segments: Pick<TranscriptSegment, "text" | "speaker" | "startMs">[], _language: string, signal: AbortSignal): Promise<MeetingSummary> {
    await sleep(900, signal);
    const all = segments.map((s) => s.text).join(" ");
    if (quoteCoverage("SOC 2 Type 2 design partner program GDPR", all) >= 0.8) return DEMO_SUMMARY;
    const speakers = new Set(segments.map((s) => s.speaker).filter(Boolean));
    return {
      summary: `Mock summary: a discussion with ${speakers.size || "several"} speaker(s) across ${segments.length} transcript lines. Connect Muse Wonder (LLM_PROVIDER=muse) for a real summary.`,
      decisions: segments.filter((s) => DECISION.test(s.text)).map((s) => s.text),
      action_items: segments.filter((s) => ACTION.test(s.text)).map((s) => ({ task: s.text, owner: s.speaker ?? "", due: "" })),
    };
  }

  async explain(s: Pick<RawSuggestion, "type" | "title" | "body" | "trigger_quote">, _context: string, _language: string, signal: AbortSignal): Promise<string> {
    await sleep(800, signal);
    const demo = DEMO_SUGGESTIONS.find((d) => similarity(d.title, s.title) > 0.7);
    return demo?.more ?? `${s.body} (Mock provider: connect Muse Wonder for a deeper explanation.)`;
  }
}
