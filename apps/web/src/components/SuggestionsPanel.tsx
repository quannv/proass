"use client";
import { useState } from "react";
import { Check, Copy, Globe, Loader2, Pin, PinOff, Sparkles, X } from "lucide-react";
import { SUGGESTION_TYPE_LABELS, formatClock } from "@proass/shared";
import { explainSuggestion } from "@/lib/controller";
import { useMeeting } from "@/store/meeting";
import type { SuggestionView } from "@/store/meeting";
import { IconButton, Panel, TYPE_META } from "./ui";

export default function SuggestionsPanel() {
  const suggestions = useMeeting((s) => s.suggestions);
  const thinking = useMeeting((s) => s.thinking);
  const searching = useMeeting((s) => s.searching);
  const visible = suggestions.filter((s) => !s.dismissed);
  const pinned = visible.filter((s) => s.pinned);
  const rest = visible.filter((s) => !s.pinned);

  return (
    <Panel
      title={
        <>
          <Sparkles className="h-4 w-4 text-violet-500" /> Insights
          {visible.length > 0 && <span className="text-xs font-normal text-zinc-400">{visible.length}</span>}
        </>
      }
      right={
        thinking &&
        (searching ? (
          <span
            className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-sky-600 dark:text-sky-400"
            title={`Searching the web: ${searching}`}
          >
            <Globe className="h-3.5 w-3.5 shrink-0 animate-pulse" />
            <span className="max-w-[16rem] truncate">Searching: {searching}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-violet-600 dark:text-violet-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </span>
        ))
      }
    >
      <div className="min-h-0 flex-1 overflow-y-auto p-3" aria-live="polite" aria-relevant="additions">
        {visible.length === 0 ? (
          <div className="mx-auto mt-10 max-w-xs text-center text-sm text-zinc-500 dark:text-zinc-400">
            <Sparkles className="mx-auto mb-3 h-6 w-6 text-zinc-300 dark:text-zinc-600" />
            Definitions, fact checks, smart questions, decisions and action items show up here as the conversation unfolds.
            <span className="mt-2 block text-xs text-zinc-400">Silence is better than noise: the assistant only speaks up when it has something useful.</span>
          </div>
        ) : (
          <div className="space-y-2.5">
            {pinned.length > 0 && <SectionLabel>Pinned</SectionLabel>}
            {pinned.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
            {pinned.length > 0 && rest.length > 0 && <SectionLabel>Latest</SectionLabel>}
            {rest.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="px-1 pt-1 text-[11px] font-semibold tracking-wide text-zinc-400 uppercase">{children}</p>;
}

function SuggestionCard({ s }: { s: SuggestionView }) {
  const patch = useMeeting((st) => st.patchSuggestion);
  const highlightSegment = useMeeting((st) => st.highlightSegment);
  const segment = useMeeting((st) => (s.segmentId ? st.segments.find((x) => x.id === s.segmentId) : undefined));
  const [copied, setCopied] = useState(false);
  const meta = TYPE_META[s.type];
  const Icon = meta.icon;

  const copy = async () => {
    const extra = s.explanation?.status === "done" ? `\n\n${s.explanation.text}` : "";
    await navigator.clipboard.writeText(`${s.title}\n${s.body}${extra}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <article className="animate-card-in relative overflow-hidden rounded-xl border border-zinc-200 bg-white p-3.5 pl-4 shadow-xs dark:border-zinc-800 dark:bg-zinc-900">
      <span className={`absolute inset-y-0 left-0 w-1 ${meta.bar}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${meta.badge}`}>
            <Icon className="h-3 w-3" /> {SUGGESTION_TYPE_LABELS[s.type]}
          </span>
          {s.confidence < 0.7 && (
            <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-[11px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400" title={`Confidence ${Math.round(s.confidence * 100)}%`}>
              Low confidence
            </span>
          )}
        </div>
        <div className="-mt-1 -mr-1.5 flex shrink-0">
          <IconButton label={s.pinned ? "Unpin" : "Pin"} active={s.pinned} onClick={() => patch(s.id, { pinned: !s.pinned })}>
            {s.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Copy" onClick={() => void copy()}>
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
          </IconButton>
          <IconButton label="Dismiss" onClick={() => patch(s.id, { dismissed: true })}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>

      <h3 className="mt-1.5 text-[15px] leading-snug font-semibold">{s.title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-zinc-600 dark:text-zinc-300">{s.body}</p>

      {s.explanation && (
        <div className="mt-2.5 rounded-lg bg-zinc-50 p-2.5 text-sm leading-relaxed text-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-200">
          {s.explanation.status === "loading" ? (
            <span className="inline-flex items-center gap-2 text-zinc-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Digging deeper…
            </span>
          ) : s.explanation.status === "error" ? (
            <span className="text-red-600 dark:text-red-400">Couldn&apos;t load more: {s.explanation.text}</span>
          ) : (
            <p className="whitespace-pre-line">{s.explanation.text}</p>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        {s.triggerQuote ? (
          <button
            disabled={!segment}
            onClick={() => segment && highlightSegment(segment.id)}
            className="min-w-0 max-w-full truncate rounded-md text-left text-xs text-zinc-500 italic enabled:hover:text-indigo-600 disabled:cursor-default dark:text-zinc-400 dark:enabled:hover:text-indigo-400"
            title={segment ? "Show in transcript" : undefined}
          >
            {segment && <span className="mr-1 font-mono not-italic">{formatClock(segment.startMs)}</span>}“{s.triggerQuote}”
          </button>
        ) : (
          <span />
        )}
        {s.explanation?.status !== "done" && (
          <button
            onClick={() => void explainSuggestion(s.id)}
            disabled={s.explanation?.status === "loading"}
            className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-50 disabled:opacity-50 dark:text-violet-300 dark:hover:bg-violet-500/10"
          >
            <Sparkles className="h-3.5 w-3.5" /> Tell me more
          </button>
        )}
      </div>
    </article>
  );
}
