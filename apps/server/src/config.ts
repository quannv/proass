import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TriggerConfig } from "@proass/shared";
import type { ProviderInfo } from "@proass/shared";

// Load env files if present (apps/server/.env first, then repo-root .env). Real env vars win.
for (const rel of ["../.env", "../../../.env"]) {
  const path = fileURLToPath(new URL(rel, import.meta.url));
  if (existsSync(path)) process.loadEnvFile(path);
}

const env = process.env;
// `muse_key` is accepted for backward compatibility with the original .env.
const museApiKey = env.MUSE_API_KEY || env.muse_key || "";

function provider(value: string | undefined): "muse" | "mock" {
  if (value === "mock" || value === "muse") return value;
  return museApiKey ? "muse" : "mock";
}

function parseOverrides(raw: string | undefined): Partial<TriggerConfig> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<TriggerConfig>;
  } catch {
    console.warn("[config] TRIGGER_OVERRIDES is not valid JSON; ignoring");
    return {};
  }
}

export const config = {
  port: Number(env.PORT || 8787),
  allowedOrigins: (env.ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  // A random secret means tokens die on restart; set SESSION_SECRET for multi-instance deploys.
  sessionSecret: env.SESSION_SECRET || randomBytes(32).toString("hex"),
  tokenTtlMs: 60 * 60 * 1000,
  /** Behind a load balancer that appends the client address to X-Forwarded-For (AWS ALB, Render). */
  trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  maxSessionsPerIpPerHour: Number(env.MAX_SESSIONS_PER_IP_PER_HOUR || 60),
  /** Open meeting sockets allowed at once, per client IP (a shared venue Wi-Fi is one IP) and in total. */
  maxConcurrentPerIp: Number(env.MAX_CONCURRENT_PER_IP || 5),
  maxConcurrent: Number(env.MAX_CONCURRENT || 25),
  /** "Tell me more" and end-of-meeting summary calls per client IP per hour. */
  maxExplainPerIpPerHour: Number(env.MAX_EXPLAIN_PER_IP_PER_HOUR || 120),
  maxSummaryPerIpPerHour: Number(env.MAX_SUMMARY_PER_IP_PER_HOUR || 20),

  museApiKey,
  museBaseUrl: env.MUSE_BASE_URL || "https://api.meta.ai/v1",
  sttProvider: provider(env.STT_PROVIDER),
  llmProvider: provider(env.LLM_PROVIDER),
  sttUrl: env.MUSE_STT_URL || "wss://api.meta.ai/v1/asr/realtime",
  sttModel: env.MUSE_STT_MODEL || "muse-voice-transcribe-1.0",
  sttMode: (env.MUSE_STT_MODE || "DIARIZATION") as "ENDPOINTING" | "DIARIZATION",
  llmModel: env.MUSE_LLM_MODEL || "muse-wonder-1.0",
  /** Muse models always reason; "minimal" keeps suggestion latency low. */
  suggestReasoningEffort: env.LLM_SUGGEST_REASONING_EFFORT || "minimal",
  deepReasoningEffort: env.LLM_DEEP_REASONING_EFFORT || "low",
  llmTimeoutMs: Number(env.LLM_TIMEOUT_MS || 25_000),
  /** Web searches allowed per insight call (Muse built-in search); 0 turns the web_search tool off. */
  webSearchMax: Number(env.WEB_SEARCH_MAX ?? 1),
  triggerOverrides: parseOverrides(env.TRIGGER_OVERRIDES),
};

/** What the browser is told about the active providers (shown in the top bar). */
export const providerInfo: ProviderInfo = {
  stt: config.sttProvider,
  llm: config.llmProvider,
  ...(config.llmProvider === "muse" && { llmModel: config.llmModel }),
};

if ((config.sttProvider === "muse" || config.llmProvider === "muse") && !museApiKey) {
  throw new Error("MUSE_API_KEY is required when STT_PROVIDER or LLM_PROVIDER is 'muse'");
}
