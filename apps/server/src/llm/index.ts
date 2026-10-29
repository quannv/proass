import { config } from "../config";
import type { LLMProvider } from "./LLMProvider";
import { MockLLMProvider } from "./MockLLMProvider";
import { MuseLLMProvider } from "./MuseLLMProvider";

export const llm: LLMProvider =
  config.llmProvider === "mock"
    ? new MockLLMProvider()
    : new MuseLLMProvider({
        apiKey: config.museApiKey,
        baseUrl: config.museBaseUrl,
        model: config.llmModel,
        suggestReasoningEffort: config.suggestReasoningEffort,
        deepReasoningEffort: config.deepReasoningEffort,
        timeoutMs: config.llmTimeoutMs,
      });

export type { LLMProvider, SuggestionContext } from "./LLMProvider";
