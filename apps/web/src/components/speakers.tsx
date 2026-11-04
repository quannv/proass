"use client";
import { useMemo, useState } from "react";
import { Pencil, Users } from "lucide-react";
import { renameSpeaker } from "@/lib/controller";
import { resolveSpeakers } from "@/lib/speakers";
import type { SpeakerInfo, SpeakerMap } from "@/lib/speakers";
import { useMeeting } from "@/store/meeting";

/** Avatar background + name colour per palette slot (slots are assigned in order of first appearance). */
const PALETTE = [
  { avatar: "bg-sky-500", text: "text-sky-700 dark:text-sky-300" },
  { avatar: "bg-rose-500", text: "text-rose-700 dark:text-rose-300" },
  { avatar: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-300" },
  { avatar: "bg-amber-500", text: "text-amber-700 dark:text-amber-300" },
  { avatar: "bg-violet-500", text: "text-violet-700 dark:text-violet-300" },
  { avatar: "bg-teal-500", text: "text-teal-700 dark:text-teal-300" },
  { avatar: "bg-fuchsia-500", text: "text-fuchsia-700 dark:text-fuchsia-300" },
  { avatar: "bg-orange-500", text: "text-orange-700 dark:text-orange-300" },
];
const NEUTRAL = { avatar: "bg-zinc-400 dark:bg-zinc-600", text: "text-zinc-600 dark:text-zinc-300" };

export const speakerTone = (s?: SpeakerInfo) => (s ? PALETTE[s.color % PALETTE.length]! : NEUTRAL);

export function useSpeakers(): SpeakerMap {
  const segments = useMeeting((s) => s.segments);
  const typed = useMeeting((s) => s.speakerNames);
  const isDemo = useMeeting((s) => s.settings.source === "demo");
  return useMemo(() => resolveSpeakers(segments, typed, isDemo), [segments, typed, isDemo]);
}

export function Avatar({ speaker, size = "md", faded }: { speaker?: SpeakerInfo; size?: "sm" | "md"; faded?: boolean }) {
  const dims = size === "sm" ? "h-6 w-6 text-[10px]" : "h-8 w-8 text-xs";
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ring-2 ring-white dark:ring-zinc-900 ${dims} ${speakerTone(speaker).avatar} ${faded ? "opacity-50" : ""}`}
    >
      {speaker?.initials ?? "?"}
    </span>
  );
}

/** Speaker name; click (or Enter) to rename. An empty name goes back to the automatic one. */
export function SpeakerName({ speaker, className = "" }: { speaker: SpeakerInfo; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const tone = speakerTone(speaker).text;

  if (editing) {
    const save = () => {
      setEditing(false);
      if (draft.trim() !== speaker.name) renameSpeaker(speaker.label, draft);
    };
    return (
      <input
        autoFocus
        value={draft}
        maxLength={40}
        aria-label={`Name for ${speaker.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
        className={`h-6 w-32 rounded-md border border-zinc-300 bg-white px-1.5 text-sm font-semibold outline-none focus:border-indigo-500 dark:border-zinc-600 dark:bg-zinc-900 ${tone}`}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(speaker.named ? speaker.name : "");
        setEditing(true);
      }}
      title="Rename speaker"
      className={`group/name inline-flex items-center gap-1 rounded-md text-sm font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500 ${tone} ${className}`}
    >
      {speaker.name}
      <Pencil className="h-3 w-3 opacity-0 transition group-hover/name:opacity-60 group-focus-visible/name:opacity-60" />
    </button>
  );
}

/** Who is in the meeting and how much each person talked. Hidden until someone has a speaker label. */
export function SpeakersBar() {
  const speakers = useSpeakers();
  if (speakers.size === 0) return null;
  const list = [...speakers.values()];
  const total = list.reduce((n, s) => n + s.talkMs, 0) || 1;
  const unnamed = list.some((s) => !s.named);
  return (
    <div className="border-b border-zinc-100 px-4 py-2 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Users className="hidden h-4 w-4 shrink-0 text-zinc-400 sm:block" aria-label="Speakers" />
        {list.map((s) => (
          <div key={s.label} className="flex shrink-0 items-center gap-2" title={s.role}>
            <Avatar speaker={s} size="sm" />
            <div className="leading-tight">
              <SpeakerName speaker={s} />
              <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className="tabular-nums">{Math.round((s.talkMs / total) * 100)}%</span>
                <span className="h-1 w-8 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
                  <span className={`block h-full ${speakerTone(s).avatar}`} style={{ width: `${(s.talkMs / total) * 100}%` }} />
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
      {unnamed && <p className="mt-1 text-[11px] text-zinc-400">Tip: click a speaker&apos;s name to rename them. Insights and notes will use the name.</p>}
    </div>
  );
}
