"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PersistStorage, StorageValue } from "zustand/middleware";
import { DEFAULT_SESSION_SETTINGS } from "@proass/shared";
import type { MeetingSummary, ProviderInfo, SessionSettings, Suggestion, TranscriptSegment } from "@proass/shared";
import type { AudioSource } from "@/audio/capture";

export type Status = "idle" | "connecting" | "listening" | "reconnecting" | "stopping" | "error";
export type Theme = "system" | "light" | "dark";

export interface Settings extends SessionSettings {
  source: AudioSource;
  deviceId: string;
  /** Demo source only: replay transcript + pre-recorded suggestions entirely in the browser. */
  offlineDemo: boolean;
  theme: Theme;
  consentDismissed: boolean;
}

export interface SuggestionView extends Suggestion {
  pinned: boolean;
  dismissed: boolean;
  explanation?: { status: "loading" | "done" | "error"; text?: string };
}

export interface SummaryState {
  status: "idle" | "loading" | "done" | "error";
  data?: MeetingSummary;
  error?: string;
}

interface MeetingState {
  settings: Settings;
  status: Status;
  error: string | null;
  /** Non-fatal, auto-dismissed message. */
  notice: string | null;
  thinking: boolean;
  /** Web search query of the current insight call (shown only while thinking). */
  searching: string | null;
  providers: ProviderInfo | "offline" | null;
  level: number;

  /** Wall-clock timer: accumulated time of previous runs + start of the current run. */
  elapsedBeforeRunMs: number;
  runStartedAt: number | null;
  /** Meeting audio position, used as resume offset for the next run. */
  audioMs: number;

  segments: TranscriptSegment[];
  partial: { text: string; speaker?: string } | null;
  suggestions: SuggestionView[];
  runningSummary: string;
  highlight: { segmentId: string; at: number } | null;
  view: "meeting" | "summary";
  summary: SummaryState;

  setSettings(patch: Partial<Settings>): void;
  set(patch: Partial<MeetingState>): void;
  addFinal(segment: TranscriptSegment): void;
  /** Keeps a half-finished line when the connection drops. */
  promotePartial(): void;
  addSuggestions(items: Suggestion[]): void;
  patchSuggestion(id: string, patch: Partial<SuggestionView>): void;
  highlightSegment(id: string): void;
  resetMeeting(): void;
}

const emptyMeeting = {
  elapsedBeforeRunMs: 0,
  runStartedAt: null,
  audioMs: 0,
  segments: [],
  partial: null,
  suggestions: [],
  runningSummary: "",
  highlight: null,
  view: "meeting" as const,
  summary: { status: "idle" as const },
};

let localSeq = 0;

/**
 * localStorage, but writes are batched: the store changes many times a second while recording
 * (level meter, partials), and serializing the whole transcript on each change makes long meetings janky.
 * The latest state is written at most once a second, and immediately when the page is hidden or closed.
 */
function throttledLocalStorage<S>(delayMs = 1000): PersistStorage<S> {
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    try {
      localStorage.setItem(pending.name, JSON.stringify(pending.value));
    } catch {
      // Quota exceeded or storage blocked: the meeting still works, it just won't survive a reload.
    }
    pending = null;
  };
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  }
  return {
    getItem: (name) => {
      try {
        const raw = localStorage.getItem(name);
        return raw ? (JSON.parse(raw) as StorageValue<S>) : null;
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      pending = { name, value };
      timer ??= setTimeout(flush, delayMs);
    },
    removeItem: (name) => {
      pending = null;
      localStorage.removeItem(name);
    },
  };
}

export const useMeeting = create<MeetingState>()(
  persist(
    (set, get) => ({
      settings: {
        ...DEFAULT_SESSION_SETTINGS,
        source: "mic",
        deviceId: "",
        offlineDemo: false,
        theme: "system",
        consentDismissed: false,
      },
      status: "idle",
      error: null,
      notice: null,
      thinking: false,
      searching: null,
      providers: null,
      level: 0,
      ...emptyMeeting,

      setSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),
      set: (patch) => set(patch),
      addFinal: (segment) => {
        if (get().segments.some((s) => s.id === segment.id)) return;
        set({ segments: [...get().segments, segment], partial: null });
      },
      promotePartial: () => {
        const { partial, segments, audioMs } = get();
        if (!partial?.text) return;
        const last = segments.at(-1);
        const startMs = last ? last.endMs : audioMs;
        get().addFinal({ id: `local-${Date.now()}-${localSeq++}`, text: `${partial.text}…`, speaker: partial.speaker, startMs, endMs: startMs });
      },
      addSuggestions: (items) =>
        set({ suggestions: [...items.map((s) => ({ ...s, pinned: false, dismissed: false })), ...get().suggestions] }),
      patchSuggestion: (id, patch) =>
        set({ suggestions: get().suggestions.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),
      highlightSegment: (id) => set({ highlight: { segmentId: id, at: Date.now() } }),
      resetMeeting: () => set({ ...emptyMeeting }),
    }),
    {
      name: "proass-meeting",
      version: 1,
      storage: throttledLocalStorage(),
      // Kept only in this browser so a reload never loses the transcript. Nothing is stored server-side.
      partialize: (s) => ({
        settings: s.settings,
        segments: s.segments,
        suggestions: s.suggestions.map(({ explanation, ...rest }) => ({
          ...rest,
          explanation: explanation?.status === "done" ? explanation : undefined,
        })),
        runningSummary: s.runningSummary,
        audioMs: s.audioMs,
        elapsedBeforeRunMs: s.elapsedBeforeRunMs,
        view: s.view,
        summary: s.summary.status === "done" ? s.summary : { status: "idle" },
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<MeetingState>;
        return { ...current, ...p, settings: { ...current.settings, ...p.settings } };
      },
    },
  ),
);

export function elapsedMs(s: Pick<MeetingState, "elapsedBeforeRunMs" | "runStartedAt">): number {
  return s.elapsedBeforeRunMs + (s.runStartedAt ? Date.now() - s.runStartedAt : 0);
}

export const isRecording = (status: Status) => status === "connecting" || status === "listening" || status === "reconnecting";
