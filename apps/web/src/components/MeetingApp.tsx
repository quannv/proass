"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, RotateCw, X } from "lucide-react";
import { pushSettings, startMeeting } from "@/lib/controller";
import { isRecording, useMeeting } from "@/store/meeting";
import ConsentBanner from "./ConsentBanner";
import SettingsDrawer from "./SettingsDrawer";
import SuggestionsPanel from "./SuggestionsPanel";
import SummaryView from "./SummaryView";
import TopBar from "./TopBar";
import TranscriptPanel from "./TranscriptPanel";

export default function MeetingApp() {
  const view = useMeeting((s) => s.view);
  const [settingsOpen, setSettingsOpen] = useState(false);
  useTheme();
  useLiveSettingsSync();

  return (
    <div className="flex h-dvh flex-col">
      <TopBar onOpenSettings={() => setSettingsOpen(true)} />
      <ConsentBanner />
      <ErrorBanner />
      {view === "summary" ? (
        <SummaryView />
      ) : (
        <main className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 gap-3 p-3 sm:gap-4 sm:p-4 lg:grid-cols-[55fr_45fr] lg:grid-rows-1">
          <TranscriptPanel />
          <SuggestionsPanel />
        </main>
      )}
      <Toast />
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

function ErrorBanner() {
  const error = useMeeting((s) => s.error);
  const set = useMeeting((s) => s.set);
  if (!error) return null;
  return (
    <div role="alert" className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 sm:mx-4 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1">{error}</span>
      <button
        onClick={() => void startMeeting()}
        className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
      >
        <RotateCw className="h-3.5 w-3.5" /> Retry
      </button>
      <button aria-label="Dismiss" onClick={() => set({ error: null, status: "idle" })} className="rounded p-1 hover:bg-red-100 dark:hover:bg-red-900/50">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Toast() {
  const notice = useMeeting((s) => s.notice);
  if (!notice) return null;
  return (
    <div role="status" className="animate-card-in pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4">
      <div className="rounded-xl bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900">{notice}</div>
    </div>
  );
}

function useTheme() {
  const theme = useMeeting((s) => s.settings.theme);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && mq.matches));
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);
}

/** Frequency, types and output language apply mid-meeting; audio settings apply on next Start. */
function useLiveSettingsSync() {
  const frequency = useMeeting((s) => s.settings.frequency);
  const types = useMeeting((s) => s.settings.enabledTypes.join(","));
  const language = useMeeting((s) => s.settings.outputLanguage);
  useEffect(() => {
    if (isRecording(useMeeting.getState().status)) pushSettings();
  }, [frequency, types, language]);
}
