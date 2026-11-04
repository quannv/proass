"use client";
import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, ChevronDown, Clipboard, Download, Gavel, ListTodo, Loader2, Pin, Plus, RotateCw } from "lucide-react";
import { DEMO_TITLE, SUGGESTION_TYPE_LABELS, formatClock } from "@proass/shared";
import { generateSummary, newMeeting } from "@/lib/controller";
import { buildMarkdown, downloadText } from "@/lib/export";
import { elapsedMs, useMeeting } from "@/store/meeting";
import { Avatar, SpeakerName, useSpeakers } from "./speakers";
import { TYPE_META } from "./ui";

export default function SummaryView() {
  const summary = useMeeting((s) => s.summary);
  const segments = useMeeting((s) => s.segments);
  const suggestions = useMeeting((s) => s.suggestions);
  const isDemo = useMeeting((s) => s.settings.source === "demo");
  const speakers = useSpeakers();
  const set = useMeeting((s) => s.set);
  const [copied, setCopied] = useState(false);
  const durationMs = Math.max(elapsedMs(useMeeting.getState()), segments.at(-1)?.endMs ?? 0);
  const title = isDemo ? DEMO_TITLE : "Meeting notes";
  const pinned = suggestions.filter((s) => s.pinned);

  const markdown = () => buildMarkdown({ title, date: new Date(), durationMs, summary: summary.data, suggestions, segments, speakers });
  const copy = async () => {
    await navigator.clipboard.writeText(markdown());
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-6 sm:py-8">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => set({ view: "meeting" })} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">
            <ArrowLeft className="h-4 w-4" /> Back to meeting
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <ActionButton onClick={() => void copy()} icon={copied ? Check : Clipboard}>
              {copied ? "Copied" : "Copy Markdown"}
            </ActionButton>
            <ActionButton onClick={() => downloadText(`meeting-${new Date().toISOString().slice(0, 10)}.md`, markdown())} icon={Download} primary>
              Export .md
            </ActionButton>
            <ActionButton onClick={newMeeting} icon={Plus}>
              New meeting
            </ActionButton>
          </div>
        </div>

        <h1 className="mt-6 text-2xl font-bold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {new Date().toLocaleDateString(undefined, { dateStyle: "long" })} · {formatClock(durationMs)} · {segments.length} transcript lines
        </p>

        {summary.status === "loading" && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-zinc-200 bg-white p-5 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
            <Loader2 className="h-4 w-4 animate-spin" /> Writing the summary, decisions and action items…
          </div>
        )}
        {summary.status === "error" && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="flex-1">Couldn&apos;t generate the summary: {summary.error}. The transcript below is safe and exportable.</span>
            <button onClick={() => void generateSummary()} className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white">
              <RotateCw className="h-3.5 w-3.5" /> Retry
            </button>
          </div>
        )}

        {summary.data && (
          <div className="mt-6 space-y-4">
            <Card title="Summary">
              <p className="leading-relaxed text-zinc-700 dark:text-zinc-200">{summary.data.summary}</p>
            </Card>
            <div className="grid gap-4 md:grid-cols-2">
              <Card title="Decisions" icon={<Gavel className="h-4 w-4 text-indigo-500" />}>
                {summary.data.decisions.length ? (
                  <ul className="space-y-2">
                    {summary.data.decisions.map((d, i) => (
                      <li key={i} className="flex gap-2 text-sm leading-relaxed">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" />
                        {d}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No decisions recorded.</Empty>
                )}
              </Card>
              <Card title="Action items" icon={<ListTodo className="h-4 w-4 text-rose-500" />}>
                {summary.data.action_items.length ? (
                  <ul className="space-y-2.5">
                    {summary.data.action_items.map((a, i) => (
                      <li key={i} className="flex gap-2.5 text-sm">
                        <input type="checkbox" className="mt-1 accent-rose-500" aria-label={`Done: ${a.task}`} />
                        <span className="leading-relaxed">
                          {a.task}
                          {(a.owner || a.due) && (
                            <span className="mt-0.5 block text-xs text-zinc-500">
                              {a.owner && <strong className="font-semibold text-zinc-700 dark:text-zinc-300">{a.owner}</strong>}
                              {a.owner && a.due && " · "}
                              {a.due && `due ${a.due}`}
                            </span>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>No action items recorded.</Empty>
                )}
              </Card>
            </div>
          </div>
        )}

        {pinned.length > 0 && (
          <Card title="Pinned insights" icon={<Pin className="h-4 w-4 text-zinc-400" />} className="mt-4">
            <ul className="space-y-3">
              {pinned.map((s) => {
                const Icon = TYPE_META[s.type].icon;
                return (
                  <li key={s.id} className="text-sm">
                    <span className={`mr-2 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${TYPE_META[s.type].badge}`}>
                      <Icon className="h-3 w-3" /> {SUGGESTION_TYPE_LABELS[s.type]}
                    </span>
                    <strong>{s.title}</strong>
                    <p className="mt-1 text-zinc-600 dark:text-zinc-300">{s.body}</p>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}

        <details className="group mt-4 rounded-2xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 font-semibold">
            Full transcript
            <ChevronDown className="h-4 w-4 transition group-open:rotate-180" />
          </summary>
          <ol className="space-y-1.5 border-t border-zinc-100 px-5 py-4 text-sm dark:border-zinc-800">
            {segments.map((s) => (
              <li key={s.id} className="grid grid-cols-[3.25rem_1fr] gap-2">
                <time className="pt-0.5 font-mono text-xs text-zinc-400">{formatClock(s.startMs)}</time>
                <p className="flex items-start gap-2">
                  {s.speaker && speakers.get(s.speaker) && <Avatar speaker={speakers.get(s.speaker)} size="sm" />}
                  <span>
                    {s.speaker && speakers.get(s.speaker) && <SpeakerName speaker={speakers.get(s.speaker)!} className="mr-1.5" />}
                    {s.text}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </main>
  );
}

function Card({ title, icon, children, className = "" }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-xs dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold">
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-zinc-400">{children}</p>;
}

function ActionButton({ onClick, icon: Icon, children, primary }: { onClick: () => void; icon: typeof Plus; children: React.ReactNode; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition ${
        primary ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border border-zinc-200 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}
