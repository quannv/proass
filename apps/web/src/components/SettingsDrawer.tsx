"use client";
import { useEffect, useState } from "react";
import { Mic, Monitor, MonitorSpeaker, Play, RotateCw, X } from "lucide-react";
import { FREQUENCIES, OUTPUT_LANGUAGES, SUGGESTION_TYPES, SUGGESTION_TYPE_LABELS } from "@proass/shared";
import { listMicrophones } from "@/audio/capture";
import type { AudioSource } from "@/audio/capture";
import { newMeeting } from "@/lib/controller";
import { isRecording, useMeeting } from "@/store/meeting";
import type { Theme } from "@/store/meeting";
import { TYPE_META } from "./ui";

const SOURCES: { id: AudioSource; label: string; hint: string; icon: typeof Mic }[] = [
  { id: "mic", label: "Microphone", hint: "In-person meetings", icon: Mic },
  { id: "tab", label: "Browser tab", hint: "Meet, Zoom web, Teams web (Chrome/Edge)", icon: Monitor },
  { id: "mic+tab", label: "Mic + tab", hint: "Online meeting incl. your voice; use headphones", icon: MonitorSpeaker },
  { id: "demo", label: "Demo meeting", hint: "Scripted 2.5-minute sample", icon: Play },
];

export default function SettingsDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const settings = useMeeting((s) => s.settings);
  const setSettings = useMeeting((s) => s.setSettings);
  const recording = useMeeting((s) => isRecording(s.status));
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [keywords, setKeywords] = useState(settings.keywords.join(", "));

  const refreshMics = () => void listMicrophones().then(setMics);
  useEffect(() => {
    if (!open) return;
    refreshMics();
    setKeywords(useMeeting.getState().settings.keywords.join(", "));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const saveKeywords = () =>
    setSettings({ keywords: [...new Set(keywords.split(",").map((k) => k.trim()).filter(Boolean))].slice(0, 100) });

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div onClick={onClose} className={`absolute inset-0 bg-zinc-950/30 backdrop-blur-[2px] transition-opacity ${open ? "opacity-100" : "opacity-0"}`} />
      <aside
        role="dialog"
        aria-label="Settings"
        className={`absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl transition-transform duration-300 dark:bg-zinc-900 ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-800">
          <h2 className="font-semibold">Settings</h2>
          <button onClick={onClose} aria-label="Close settings" className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-7 overflow-y-auto px-5 py-5 text-sm">
          <Section title="Audio source" note={recording ? "Applies the next time you press Start." : undefined}>
            <div className="grid grid-cols-2 gap-2">
              {SOURCES.map(({ id, label, hint, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setSettings({ source: id })}
                  className={`rounded-xl border p-3 text-left transition ${
                    settings.source === id
                      ? "border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500 dark:bg-indigo-500/10"
                      : "border-zinc-200 hover:border-zinc-300 dark:border-zinc-700 dark:hover:border-zinc-600"
                  }`}
                >
                  <Icon className="mb-1.5 h-4 w-4" />
                  <span className="block font-medium">{label}</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">{hint}</span>
                </button>
              ))}
            </div>
            {(settings.source === "mic" || settings.source === "mic+tab") && (
              <div className="mt-3 flex gap-2">
                <select
                  value={settings.deviceId}
                  onChange={(e) => setSettings({ deviceId: e.target.value })}
                  className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-transparent px-2 dark:border-zinc-700 dark:bg-zinc-900"
                  aria-label="Microphone"
                >
                  <option value="">Default microphone</option>
                  {mics
                    .filter((m) => m.deviceId && m.deviceId !== "default")
                    .map((m, i) => (
                      <option key={m.deviceId} value={m.deviceId}>
                        {m.label || `Microphone ${i + 1}`}
                      </option>
                    ))}
                </select>
                <button onClick={refreshMics} aria-label="Refresh devices" className="rounded-lg border border-zinc-200 px-2.5 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800">
                  <RotateCw className="h-4 w-4" />
                </button>
              </div>
            )}
            {settings.source === "demo" && (
              <label className="mt-3 flex items-start gap-2.5 rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/60">
                <input type="checkbox" checked={settings.offlineDemo} onChange={(e) => setSettings({ offlineDemo: e.target.checked })} className="mt-0.5 accent-indigo-600" />
                <span>
                  <span className="font-medium">Offline mode</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    No network needed: replays the scripted transcript and pre-recorded insights in the browser. Turn off to run the sample audio through the live Muse pipeline.
                  </span>
                </span>
              </label>
            )}
          </Section>

          <Section title="Suggestion frequency">
            <div className="grid grid-cols-3 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
              {FREQUENCIES.map((f) => (
                <button
                  key={f}
                  onClick={() => setSettings({ frequency: f })}
                  className={`rounded-lg py-1.5 font-medium capitalize transition ${settings.frequency === f ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500"}`}
                >
                  {f}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Insight types">
            <div className="grid grid-cols-2 gap-1.5">
              {SUGGESTION_TYPES.map((t) => {
                const Icon = TYPE_META[t].icon;
                const on = settings.enabledTypes.includes(t);
                return (
                  <label key={t} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        setSettings({ enabledTypes: on ? settings.enabledTypes.filter((x) => x !== t) : [...settings.enabledTypes, t] })
                      }
                      className="accent-indigo-600"
                    />
                    <Icon className="h-3.5 w-3.5 text-zinc-400" />
                    {SUGGESTION_TYPE_LABELS[t]}
                  </label>
                );
              })}
            </div>
          </Section>

          <Section title="Insight language">
            <select
              value={settings.outputLanguage}
              onChange={(e) => setSettings({ outputLanguage: e.target.value })}
              className="h-9 w-full rounded-lg border border-zinc-200 bg-transparent px-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {OUTPUT_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </Section>

          <Section title="Vocabulary hints" note="Names, products and acronyms the transcriber might mishear. Comma-separated.">
            <textarea
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              onBlur={saveKeywords}
              rows={2}
              placeholder="e.g. Muse Spark, Kubernetes, OKR, Nguyễn"
              className="w-full rounded-lg border border-zinc-200 bg-transparent p-2 dark:border-zinc-700"
            />
          </Section>

          <Section title="Appearance">
            <div className="grid grid-cols-3 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800">
              {(["system", "light", "dark"] as Theme[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setSettings({ theme: t })}
                  className={`rounded-lg py-1.5 font-medium capitalize transition ${settings.theme === t ? "bg-white shadow-sm dark:bg-zinc-700" : "text-zinc-500"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Privacy">
            <p className="text-zinc-500 dark:text-zinc-400">
              Audio and text pass through the server only to reach Muse; nothing is stored there. The transcript is kept in this browser so a reload doesn&apos;t lose it.
            </p>
            <button
              disabled={recording}
              onClick={() => {
                newMeeting();
                onClose();
              }}
              className="mt-2 rounded-lg border border-red-200 px-3 py-1.5 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/40"
            >
              Clear transcript &amp; insights
            </button>
          </Section>
        </div>
      </aside>
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-semibold">{title}</h3>
      {children}
      {note && <p className="mt-1.5 text-xs text-zinc-500 dark:text-zinc-400">{note}</p>}
    </section>
  );
}
