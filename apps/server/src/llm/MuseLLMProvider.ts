import {
  MEETING_SUMMARY_JSON_SCHEMA,
  MeetingSummarySchema,
  RawSuggestionEnvelopeSchema,
  SUGGESTIONS_JSON_SCHEMA,
} from "@proass/shared";
import type { MeetingSummary, RawSuggestion, TranscriptSegment } from "@proass/shared";
import type { LLMProvider, SuggestionContext } from "./LLMProvider";
import * as P from "./prompts";

export interface MuseLLMOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  suggestReasoningEffort: string;
  deepReasoningEffort: string;
  timeoutMs: number;
}

interface ChatRequest {
  system: string;
  user: string;
  reasoningEffort: string;
  maxTokens: number;
  jsonSchema?: { name: string; schema: object };
}

/** Muse LLM (model from MUSE_LLM_MODEL, e.g. muse-wonder-1.0) via the OpenAI-compatible Chat Completions API (https://dev.meta.ai/docs/protocols/chat-completions). */
export class MuseLLMProvider implements LLMProvider {
  constructor(private readonly opts: MuseLLMOptions) {}

  async generateSuggestions(ctx: SuggestionContext, signal: AbortSignal): Promise<unknown[]> {
    const content = await this.chat(
      {
        system: P.SUGGESTION_SYSTEM_PROMPT,
        user: P.buildSuggestionPrompt(ctx),
        reasoningEffort: this.opts.suggestReasoningEffort,
        maxTokens: 1500,
        jsonSchema: { name: "suggestions", schema: SUGGESTIONS_JSON_SCHEMA },
      },
      signal,
    );
    return RawSuggestionEnvelopeSchema.parse(JSON.parse(content)).suggestions;
  }

  async updateSummary(previous: string, segments: TranscriptSegment[], language: string, signal: AbortSignal): Promise<string> {
    const content = await this.chat(
      {
        system: P.SUMMARY_UPDATE_SYSTEM_PROMPT,
        user: P.buildSummaryUpdatePrompt(previous, segments, language),
        reasoningEffort: this.opts.suggestReasoningEffort,
        maxTokens: 1200,
      },
      signal,
    );
    return content.trim();
  }

  async summarizeMeeting(segments: Pick<TranscriptSegment, "text" | "speaker" | "startMs">[], language: string, signal: AbortSignal): Promise<MeetingSummary> {
    const content = await this.chat(
      {
        system: P.MEETING_SUMMARY_SYSTEM_PROMPT,
        user: P.buildMeetingSummaryPrompt(segments, language),
        reasoningEffort: this.opts.deepReasoningEffort,
        maxTokens: 4000,
        jsonSchema: { name: "meeting_summary", schema: MEETING_SUMMARY_JSON_SCHEMA },
      },
      signal,
      90_000,
    );
    return MeetingSummarySchema.parse(JSON.parse(content));
  }

  async explain(s: Pick<RawSuggestion, "type" | "title" | "body" | "trigger_quote">, context: string, language: string, signal: AbortSignal): Promise<string> {
    const content = await this.chat(
      {
        system: P.EXPLAIN_SYSTEM_PROMPT,
        user: P.buildExplainPrompt(s, context, language),
        reasoningEffort: this.opts.deepReasoningEffort,
        maxTokens: 2000,
      },
      signal,
    );
    return content.trim();
  }

  private async chat(req: ChatRequest, signal: AbortSignal, timeoutMs = this.opts.timeoutMs): Promise<string> {
    const body: Record<string, unknown> = {
      model: this.opts.model,
      messages: [
        { role: "developer", content: req.system },
        { role: "user", content: req.user },
      ],
      reasoning_effort: req.reasoningEffort,
      // Reasoning tokens count toward this limit too, so leave headroom.
      max_completion_tokens: req.maxTokens,
    };
    if (req.jsonSchema) {
      body.response_format = { type: "json_schema", json_schema: { ...req.jsonSchema, strict: true } };
    }

    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (res.ok) {
        const json = (await res.json()) as { choices?: { message?: { content?: string | null }; finish_reason?: string }[] };
        const choice = json.choices?.[0];
        const content = choice?.message?.content;
        if (!content) throw new Error(`Empty LLM response (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
        return content;
      }
      const retryable = res.status === 429 || res.status >= 500;
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (!retryable || attempt >= 1 || signal.aborted) throw new Error(`LLM request failed (${res.status}): ${detail}`);
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}
