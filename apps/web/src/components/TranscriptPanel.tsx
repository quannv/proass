"use client";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, AudioLines, ChevronDown, Play } from "lucide-react";
import { formatClock } from "@proass/shared";
import type { TranscriptSegment } from "@proass/shared";
import { startMeeting } from "@/lib/controller";
import type { SpeakerInfo } from "@/lib/speakers";
import { isRecording, useMeeting } from "@/store/meeting";
import { Avatar, SpeakerName, SpeakersBar, useSpeakers } from "./speakers";
import { Panel } from "./ui";

/** Consecutive lines by the same speaker are shown as one turn under a single avatar. */
function groupTurns(segments: TranscriptSegment[]): { speaker?: string; segments: TranscriptSegment[] }[] {
  const turns: { speaker?: string; segments: TranscriptSegment[] }[] = [];
  for (const seg of segments) {
    const last = turns.at(-1);
    if (last && last.speaker === seg.speaker) last.segments.push(seg);
    else turns.push({ speaker: seg.speaker, segments: [seg] });
  }
  return turns;
}

export default function TranscriptPanel() {
  const segments = useMeeting((s) => s.segments);
  const partial = useMeeting((s) => s.partial);
  const highlight = useMeeting((s) => s.highlight);
  const status = useMeeting((s) => s.status);
  const speakers = useSpeakers();
  const turns = useMemo(() => groupTurns(segments), [segments]);
  const scroller = useRef<HTMLDivElement>(null);
  const [following, setFollowing] = useState(true);

  // Auto-scroll only while the user is at the bottom; scrolling up pauses it.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && following) el.scrollTop = el.scrollHeight;
  }, [segments.length, partial?.text, following]);

  useEffect(() => {
    if (!highlight) return;
    setFollowing(false);
    document.getElementById(`seg-${highlight.segmentId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlight]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  };

  return (
    <Panel
      title={
        <>
          <AudioLines className="h-4 w-4 text-zinc-400" /> Live transcript
          {segments.length > 0 && <span className="text-xs font-normal text-zinc-400">{segments.length} lines</span>}
        </>
      }
    >
      <SpeakersBar />
      <RunningSummary />
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-3">
          {segments.length === 0 && !partial ? (
            <EmptyState recording={isRecording(status)} />
          ) : (
            <ol className="space-y-1">
              {turns.map((turn) => {
                const who = turn.speaker ? speakers.get(turn.speaker) : undefined;
                const first = turn.segments[0]!;
                return (
                  <li key={first.id} className="flex gap-3 px-1 py-1.5">
                    {who ? <Avatar speaker={who} /> : <span className="w-8 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        {who && <SpeakerName speaker={who} />}
                        {who?.role && <span className="text-xs text-zinc-400">{who.role}</span>}
                        <time className="font-mono text-xs text-zinc-400 tabular-nums">{formatClock(first.startMs)}</time>
                      </div>
                      {turn.segments.map((s) => (
                        <p
                          key={highlight?.segmentId === s.id ? `${s.id}-${highlight.at}` : s.id}
                          id={`seg-${s.id}`}
                          title={formatClock(s.startMs)}
                          className={`-mx-1.5 rounded-md px-1.5 py-0.5 text-[15px] leading-relaxed ${highlight?.segmentId === s.id ? "animate-flash" : ""}`}
                        >
                          {s.text}
                        </p>
                      ))}
                    </div>
                  </li>
                );
              })}
              {partial && <PartialLine text={partial.text} speaker={partial.speaker ? speakers.get(partial.speaker) : undefined} />}
            </ol>
          )}
        </div>
        {!following && (
          <button
            onClick={() => setFollowing(true)}
            className="animate-card-in absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-900"
          >
            <ArrowDown className="h-3.5 w-3.5" /> Jump to live
          </button>
        )}
      </div>
    </Panel>
  );
}

/** The line being spoken right now. Live Muse partials carry no speaker yet; the demo script's do. */
function PartialLine({ text, speaker }: { text: string; speaker?: SpeakerInfo }) {
  return (
    <li className="flex gap-3 px-1 py-1.5">
      {speaker ? (
        <Avatar speaker={speaker} faded />
      ) : (
        <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800">
          <AudioLines className="h-4 w-4 animate-pulse text-zinc-400" />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 text-sm font-semibold text-zinc-400">{speaker?.name ?? "Speaking…"}</div>
        <p className="text-[15px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          {text}
          <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-zinc-400" />
        </p>
      </div>
    </li>
  );
}

function RunningSummary() {
  const summary = useMeeting((s) => s.runningSummary);
  if (!summary) return null;
  return (
    <details className="group border-b border-zinc-100 px-4 py-2 text-sm dark:border-zinc-800">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-zinc-500">
        <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" /> Meeting so far
      </summary>
      <p className="mt-2 whitespace-pre-line text-zinc-600 dark:text-zinc-300">{summary}</p>
    </details>
  );
}

function EmptyState({ recording }: { recording: boolean }) {
  const setSettings = useMeeting((s) => s.setSettings);
  if (recording) {
    return <p className="mt-10 text-center text-sm text-zinc-400">Listening… the transcript appears here as people speak.</p>;
  }
  return (
    <div className="mx-auto mt-10 max-w-sm text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
        <AudioLines className="h-6 w-6 text-zinc-400" />
      </div>
      <h3 className="font-semibold">Ready when your meeting is</h3>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Press <strong>Start</strong> to transcribe your microphone. Insights appear on the right only when they are worth your attention.
      </p>
      <button
        onClick={() => {
          setSettings({ source: "demo" });
          void startMeeting();
        }}
        className="mt-4 inline-flex items-center gap-2 rounded-xl border border-zinc-200 px-3.5 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        <Play className="h-4 w-4" /> Play the sample meeting
      </button>
    </div>
  );
}
