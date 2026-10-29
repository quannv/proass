"use client";
import { DEMO_AUDIO_URL, DEMO_KEYWORDS, DEMO_SUGGESTIONS, DEMO_SUMMARY, formatClock, similarity } from "@proass/shared";
import type { ClientMessage, ServerMessage, SessionSettings } from "@proass/shared";
import { CaptureError, startCapture } from "@/audio/capture";
import type { CaptureHandle } from "@/audio/capture";
import { WS_URL, explain, getSession, summarize } from "@/lib/api";
import { startOfflineDemo } from "@/lib/offline-demo";
import { WsClient } from "@/lib/ws-client";
import { elapsedMs, isRecording, useMeeting } from "@/store/meeting";

/** Imperative meeting lifecycle; UI components only call these functions and read the store. */

let ws: WsClient | null = null;
let capture: CaptureHandle | null = null;
let offline: { stop(): void } | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let ranOffline = false;

const store = () => useMeeting.getState();

function sessionSettings(): SessionSettings {
  const { frequency, enabledTypes, outputLanguage, spokenLanguages, keywords, source } = store().settings;
  return {
    frequency,
    enabledTypes,
    outputLanguage,
    spokenLanguages,
    keywords: source === "demo" ? [...new Set([...keywords, ...DEMO_KEYWORDS])] : keywords,
  };
}

export function showNotice(message: string): void {
  store().set({ notice: message });
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => store().set({ notice: null }), 6000);
}

export async function startMeeting(): Promise<void> {
  const s = store();
  if (isRecording(s.status) || s.status === "stopping") return;
  const { settings } = s;
  // The demo always starts from the top; otherwise Start resumes the current meeting.
  if (settings.source === "demo" || s.view === "summary") s.resetMeeting();
  s.set({ status: "connecting", error: null, notice: null, thinking: false, view: "meeting" });

  try {
    capture = await startCapture({
      source: settings.source,
      deviceId: settings.deviceId || undefined,
      demoUrl: DEMO_AUDIO_URL,
      onChunk: (pcm) => ws?.sendAudio(pcm),
      onLevel: (rms) => store().set({ level: Math.min(1, rms * 4) }),
      onEnded: (reason) => {
        if (reason === "demo_ended") setTimeout(() => void stopMeeting(), 2500);
        else {
          showNotice(reason === "tab_ended" ? "Tab sharing stopped." : "Microphone disconnected.");
          void stopMeeting();
        }
      },
    });
  } catch (err) {
    store().set({ status: "error", error: err instanceof CaptureError ? err.message : String(err) });
    return;
  }

  store().set({ runStartedAt: Date.now() });
  ranOffline = settings.source === "demo" && settings.offlineDemo;
  if (ranOffline) {
    store().set({ status: "listening", providers: "offline" });
    offline = startOfflineDemo(capture.audio, settings.enabledTypes, {
      onEvent: (e) => (e.type === "partial" ? store().set({ partial: { text: e.text, speaker: e.speaker } }) : store().addFinal(e.segment)),
      onThinking: (active) => store().set({ thinking: active }),
      onSuggestions: (items) => store().addSuggestions(items),
    });
    return;
  }

  ws = new WsClient({
    startOffsetMs: store().audioMs,
    getUrl: async (reconnecting) => {
      const session = await getSession(reconnecting);
      store().set({ providers: session.providers });
      return `${WS_URL}/ws?token=${encodeURIComponent(session.token)}`;
    },
    buildStart: (elapsed): ClientMessage => {
      const st = store();
      const recentFrom = (st.segments.at(-1)?.endMs ?? 0) - 180_000;
      return {
        type: "start",
        settings: sessionSettings(),
        resume: {
          elapsedMs: elapsed,
          segments: st.segments.filter((x) => x.endMs >= recentFrom).slice(-400),
          summary: st.runningSummary,
          shown: st.suggestions.slice(0, 300).map((x) => ({ type: x.type, title: x.title })),
        },
      };
    },
    onMessage: handleServerMessage,
    onState: (state) => {
      if (state === "open") store().set({ status: "listening", error: null });
      else if (state === "reconnecting") {
        store().promotePartial();
        store().set({ status: "reconnecting", thinking: false });
      }
    },
    onFatal: (message) => {
      store().promotePartial();
      teardownCapture();
      ws = null;
      finishRun();
      store().set({ status: "error", error: message });
    },
  });
  ws.connect();
}

function handleServerMessage(msg: ServerMessage): void {
  const s = store();
  switch (msg.type) {
    case "ready":
      s.set({ providers: msg.providers });
      break;
    case "partial":
      s.set({ partial: { text: msg.text, speaker: msg.speaker } });
      break;
    case "final":
      s.addFinal(msg.segment);
      break;
    case "thinking":
      s.set({ thinking: msg.active });
      break;
    case "suggestions":
      s.addSuggestions(msg.items);
      break;
    case "summary_update":
      s.set({ runningSummary: msg.summary });
      break;
    case "error":
      showNotice(msg.message);
      break;
  }
}

function teardownCapture(): void {
  capture?.stop();
  capture = null;
  store().set({ level: 0 });
}

function finishRun(): void {
  const s = store();
  s.set({
    elapsedBeforeRunMs: elapsedMs(s),
    runStartedAt: null,
    audioMs: ws ? ws.audioMs : s.audioMs,
    thinking: false,
  });
}

export async function stopMeeting(): Promise<void> {
  const s = store();
  if (!isRecording(s.status)) return;
  s.set({ status: "stopping" });
  teardownCapture();
  offline?.stop();
  offline = null;
  await ws?.stop();
  store().promotePartial();
  finishRun();
  ws = null;
  store().set({ status: "idle" });
}

export function pushSettings(): void {
  ws?.send({ type: "settings", settings: sessionSettings() });
}

export async function endMeeting(): Promise<void> {
  await stopMeeting();
  store().set({ view: "summary" });
  await generateSummary();
}

export async function generateSummary(): Promise<void> {
  const s = store();
  if (!s.segments.length) {
    s.set({ summary: { status: "done", data: { summary: "No transcript was captured.", decisions: [], action_items: [] } } });
    return;
  }
  s.set({ summary: { status: "loading" } });
  try {
    const data = ranOffline
      ? await new Promise<typeof DEMO_SUMMARY>((r) => setTimeout(() => r(DEMO_SUMMARY), 1200))
      : await summarize({
          segments: s.segments.map(({ text, speaker, startMs }) => ({ text, speaker, startMs })),
          language: s.settings.outputLanguage,
        });
    store().set({ summary: { status: "done", data } });
  } catch (err) {
    store().set({ summary: { status: "error", error: (err as Error).message } });
  }
}

export async function explainSuggestion(id: string): Promise<void> {
  const s = store();
  const item = s.suggestions.find((x) => x.id === id);
  if (!item || item.explanation?.status === "loading") return;
  s.patchSuggestion(id, { explanation: { status: "loading" } });
  try {
    let text: string;
    const cached = DEMO_SUGGESTIONS.find((d) => similarity(d.title, item.title) > 0.8);
    if (ranOffline || s.providers === "offline") {
      text = cached?.more ?? "A deeper explanation isn't available in offline demo mode.";
    } else {
      const context = s.segments
        .slice(-40)
        .map((x) => `[${formatClock(x.startMs)}]${x.speaker ? ` ${x.speaker}:` : ""} ${x.text}`)
        .join("\n");
      ({ text } = await explain({
        suggestion: { type: item.type, title: item.title, body: item.body, triggerQuote: item.triggerQuote },
        context,
        language: s.settings.outputLanguage,
      }));
    }
    store().patchSuggestion(id, { explanation: { status: "done", text } });
  } catch (err) {
    store().patchSuggestion(id, { explanation: { status: "error", text: (err as Error).message } });
  }
}

export function newMeeting(): void {
  ranOffline = false;
  store().resetMeeting();
}
