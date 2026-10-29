import type { SessionSettings } from "@proass/shared";
import { config } from "../config";
import { MockSTTProvider } from "./MockSTTProvider";
import { MuseSTTProvider } from "./MuseSTTProvider";
import type { STTProvider } from "./STTProvider";

export function createSTTProvider(settings: SessionSettings, startAtMs: number): STTProvider {
  if (config.sttProvider === "mock") return new MockSTTProvider(startAtMs);
  return new MuseSTTProvider({
    apiKey: config.museApiKey,
    url: config.sttUrl,
    model: config.sttModel,
    mode: config.sttMode,
    keywords: settings.keywords,
    languageBias: settings.spokenLanguages,
  });
}

export type { STTProvider, STTHandlers, SttFinal } from "./STTProvider";
