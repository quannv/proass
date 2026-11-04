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
  /** Max web searches per suggestion call; 0 disables the web_search tool. */
  maxSearches: number;
}

interface ChatRequest {
  system: string;
  user: string;
  reasoningEffort: string;
  maxTokens: number;
  jsonSchema?: { name: string; schema: object };
}

interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

type Message =
  | { role: "developer" | "user"; content: string }
  | { role: "assistant"; content: string; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

interface Choice {
  message?: { content?: string | null; tool_calls?: ToolCall[] };
  finish_reason?: string;
}

/** Function tool the model may call during suggestion generation; we run it with Muse's built-in search. */
const WEB_SEARCH_TOOL = {
  type: "function",
  function: {
    name: "web_search",
    description: "Search web for real-time prices, news",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
};

const SEARCH_INSTRUCTIONS =
  "You are a search backend. Search the web and reply with only the key facts (numbers, dates, source names) in under 80 words. No preamble.";

/** Muse LLM (model from MUSE_LLM_MODEL, e.g. muse-wonder-1.0) via the OpenAI-compatible Chat Completions API (https://dev.meta.ai/docs/protocols/chat-completions). */
export class MuseLLMProvider implements LLMProvider {
  constructor(private readonly opts: MuseLLMOptions) {}

  async generateSuggestions(ctx: SuggestionContext, signal: AbortSignal): Promise<unknown[]> {
    const useSearch = this.opts.maxSearches > 0;
    const messages: Message[] = [
      { role: "developer", content: useSearch ? `${P.SUGGESTION_SYSTEM_PROMPT}\n\n${P.WEB_SEARCH_GUIDANCE}` : P.SUGGESTION_SYSTEM_PROMPT },
      { role: "user", content: P.buildSuggestionPrompt(ctx) },
    ];
    let searchesLeft = this.opts.maxSearches;
    for (let round = 0; ; round++) {
      // Once the budget is spent (or malformed calls keep coming), the tool is dropped so the model has to answer.
      const offerTool = searchesLeft > 0 && round <= this.opts.maxSearches;
      const choice = await this.complete(
        {
          messages,
          reasoning_effort: this.opts.suggestReasoningEffort,
          max_completion_tokens: 1500,
          response_format: { type: "json_schema", json_schema: { name: "suggestions", schema: SUGGESTIONS_JSON_SCHEMA, strict: true } },
          ...(offerTool && { tools: [WEB_SEARCH_TOOL], tool_choice: "auto", parallel_tool_calls: false }),
        },
        signal,
      );
      const calls = choice.message?.tool_calls;
      if (!calls?.length) return RawSuggestionEnvelopeSchema.parse(JSON.parse(requireContent(choice))).suggestions;

      // Every tool call needs a matching tool message, even ones over budget.
      messages.push({ role: "assistant", content: choice.message?.content ?? "", tool_calls: calls });
      for (const call of calls) {
        let result: string;
        const query = parseQuery(call);
        if (call.function.name !== "web_search" || !query) result = "Unknown tool or missing query.";
        else if (searchesLeft <= 0) result = "Search limit reached; answer from what you already know.";
        else {
          searchesLeft--;
          ctx.onSearch?.(query);
          result = await this.webSearch(query, signal);
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }
    }
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

  /**
   * Runs one query through Muse's built-in web_search (Responses API, https://dev.meta.ai/docs/protocols/responses).
   * Failures come back as text so the model can still answer without the search.
   */
  private async webSearch(query: string, signal: AbortSignal): Promise<string> {
    try {
      const json = (await this.post(
        "/responses",
        {
          model: this.opts.model,
          reasoning: { effort: "minimal" },
          max_output_tokens: 600,
          tools: [{ type: "web_search" }],
          instructions: SEARCH_INSTRUCTIONS,
          input: query,
        },
        signal,
        this.opts.timeoutMs,
      )) as { output?: { type: string; content?: { text?: string }[] }[] };
      // The last message holds the answer; earlier ones are "let me look that up" preambles.
      const last = json.output?.filter((o) => o.type === "message").at(-1);
      const text = last?.content?.map((c) => c.text ?? "").join("").trim();
      return text ? text.slice(0, 2000) : "Search returned no results.";
    } catch (err) {
      if (signal.aborted) throw err;
      return `Search failed (${(err as Error).message.slice(0, 120)}); answer from what you already know.`;
    }
  }

  private async chat(req: ChatRequest, signal: AbortSignal, timeoutMs = this.opts.timeoutMs): Promise<string> {
    const choice = await this.complete(
      {
        messages: [
          { role: "developer", content: req.system },
          { role: "user", content: req.user },
        ],
        reasoning_effort: req.reasoningEffort,
        // Reasoning tokens count toward this limit too, so leave headroom.
        max_completion_tokens: req.maxTokens,
        ...(req.jsonSchema && { response_format: { type: "json_schema", json_schema: { ...req.jsonSchema, strict: true } } }),
      },
      signal,
      timeoutMs,
    );
    return requireContent(choice);
  }

  private async complete(body: Record<string, unknown>, signal: AbortSignal, timeoutMs = this.opts.timeoutMs): Promise<Choice> {
    const json = (await this.post("/chat/completions", { model: this.opts.model, ...body }, signal, timeoutMs)) as { choices?: Choice[] };
    const choice = json.choices?.[0];
    if (!choice) throw new Error("Empty LLM response");
    return choice;
  }

  /** POST with one retry on 429/5xx. */
  private async post(path: string, body: unknown, signal: AbortSignal, timeoutMs: number): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.opts.baseUrl}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.opts.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (res.ok) return res.json();
      const retryable = res.status === 429 || res.status >= 500;
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      if (!retryable || attempt >= 1 || signal.aborted) throw new Error(`LLM request failed (${res.status}): ${detail}`);
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 800);
        signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
      });
    }
  }
}

function requireContent(choice: Choice): string {
  const content = choice.message?.content;
  if (!content) throw new Error(`Empty LLM response (finish_reason: ${choice.finish_reason ?? "unknown"})`);
  return content;
}

function parseQuery(call: ToolCall): string | null {
  try {
    const { query } = JSON.parse(call.function.arguments) as { query?: unknown };
    return typeof query === "string" && query.trim() ? query.trim().slice(0, 300) : null;
  } catch {
    return null;
  }
}
