"use client";
import { useEffect, useState } from "react";
import { FileText, Loader2, Mic, Monitor, Moon, Play, Settings, Sparkles, Square, Sun } from "lucide-react";
import { STT_LANGUAGES, formatClock } from "@proass/shared";
import { endMeeting, startMeeting, stopMeeting } from "@/lib/controller";
import { elapsedMs, isRecording, useMeeting } from "@/store/meeting";
import type { Theme } from "@/store/meeting";
import { IconButton } from "./ui";

export default function TopBar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const status = useMeeting((s) => s.status);
  const source = useMeeting((s) => s.settings.source);
  const hasTranscript = useMeeting((s) => s.segments.length > 0);
  const view = useMeeting((s) => s.view);
  const recording = isRecording(status);

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-zinc-200 bg-white/80 px-3 py-2.5 backdrop-blur sm:px-4 dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="truncate text-sm font-semibold">ProActive Assistant</h1>
          <ProviderBadge />
        </div>
      </div>

      <div className="order-3 flex w-full items-center gap-3 sm:order-none sm:ml-auto sm:w-auto">
        {recording && <RecIndicator />}
        <StatusPill />
      </div>

      <div className="ml-auto flex items-center gap-1.5 sm:ml-0">
        <LanguageSelect />
        {hasTranscript && view === "meeting" && status !== "stopping" && (
          <button
            onClick={() => void endMeeting()}
            className="hidden items-center gap-1.5 rounded-xl border border-zinc-200 px-3 py-2 text-sm font-medium hover:bg-zinc-100 sm:inline-flex dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            <FileText className="h-4 w-4" /> End &amp; summarize
          </button>
        )}
        <button
          onClick={() => void (recording ? stopMeeting() : startMeeting())}
          disabled={status === "stopping"}
          className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${
            recording ? "bg-red-600 hover:bg-red-700 focus-visible:outline-red-500" : "bg-indigo-600 hover:bg-indigo-700 focus-visible:outline-indigo-500"
          }`}
        >
          {status === "stopping" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : recording ? (
            <Square className="h-4 w-4 fill-current" />
          ) : source === "demo" ? (
            <Play className="h-4 w-4 fill-current" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
          {status === "stopping" ? "Finishing…" : recording ? "Stop" : source === "demo" ? "Play demo" : hasTranscript && view === "meeting" ? "Resume" : "Start"}
        </button>
        <ThemeToggle />
        <IconButton label="Settings" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
        </IconButton>
      </div>
    </header>
  );
}

function ProviderBadge() {
  const providers = useMeeting((s) => s.providers);
  const source = useMeeting((s) => s.settings.source);
  let text = source === "demo" ? "Demo meeting" : "Live meeting companion";
  if (providers === "offline") text = "Offline demo · pre-recorded";
  else if (providers) {
    const stt = providers.stt === "muse" ? "Muse Voice Transcribe" : "Mock STT";
    const llm = providers.llm === "muse" ? "Muse Spark" : "Mock LLM";
    text = `${stt} · ${llm}`;
  }
  return <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">{text}</p>;
}

function RecIndicator() {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const ms = elapsedMs(useMeeting.getState());
  return (
    <div className="flex items-center gap-2 rounded-full bg-red-50 py-1 pr-3 pl-2 text-xs font-semibold text-red-700 dark:bg-red-950/60 dark:text-red-300" aria-live="off">
      <span className="relative flex h-2.5 w-2.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-600" />
      </span>
      REC <span className="font-mono tabular-nums">{formatClock(ms)}</span>
      <LevelMeter />
    </div>
  );
}

function LevelMeter() {
  const level = useMeeting((s) => s.level);
  return (
    <span className="ml-1 flex h-3 items-end gap-0.5" aria-hidden>
      {[0.08, 0.2, 0.35, 0.55, 0.75].map((t) => (
        <span key={t} className={`w-0.5 rounded-full transition-all duration-100 ${level > t ? "bg-red-500" : "bg-red-200 dark:bg-red-900"}`} style={{ height: `${30 + t * 90}%` }} />
      ))}
    </span>
  );
}

function StatusPill() {
  const status = useMeeting((s) => s.status);
  const thinking = useMeeting((s) => s.thinking);
  const map = {
    idle: ["Ready", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", false],
    connecting: ["Connecting…", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", true],
    listening: thinking
      ? ["Thinking…", "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", true]
      : ["Listening", "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", false],
    reconnecting: ["Reconnecting…", "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", true],
    stopping: ["Finishing…", "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300", true],
    error: ["Error", "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300", false],
  } as const;
  const [label, cls, spin] = map[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${cls}`} role="status">
      {spin ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {label}
    </span>
  );
}

function LanguageSelect() {
  const spoken = useMeeting((s) => s.settings.spokenLanguages);
  const setSettings = useMeeting((s) => s.setSettings);
  return (
    <label className="hidden items-center md:flex" title="Spoken language (helps transcription; applies on next Start)">
      <span className="sr-only">Spoken language</span>
      <select
        value={spoken[0] ?? ""}
        onChange={(e) => setSettings({ spokenLanguages: e.target.value ? [e.target.value as (typeof STT_LANGUAGES)[number]] : [] })}
        className="h-9 rounded-xl border border-zinc-200 bg-transparent px-2.5 text-sm dark:border-zinc-700 dark:bg-zinc-900"
      >
        <option value="">Auto-detect language</option>
        {STT_LANGUAGES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

const NEXT_THEME: Record<Theme, Theme> = { system: "light", light: "dark", dark: "system" };

function ThemeToggle() {
  const theme = useMeeting((s) => s.settings.theme);
  const setSettings = useMeeting((s) => s.setSettings);
  const Icon = theme === "light" ? Sun : theme === "dark" ? Moon : Monitor;
  return (
    <IconButton label={`Theme: ${theme}`} onClick={() => setSettings({ theme: NEXT_THEME[theme] })}>
      <Icon className="h-4 w-4" />
    </IconButton>
  );
}
