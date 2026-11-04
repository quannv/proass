"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowDown, AudioLines, ChevronDown, Play } from "lucide-react";
import { formatClock } from "@proass/shared";
import { startMeeting } from "@/lib/controller";
import { speakerName } from "@/lib/export";
import { isRecording, useMeeting } from "@/store/meeting";
import { Panel, speakerColor } from "./ui";

export default function TranscriptPanel() {
  const segments = useMeeting((s) => s.segments);
  const partial = useMeeting((s) => s.partial);
  const highlight = useMeeting((s) => s.highlight);
  const status = useMeeting((s) => s.status);
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
      <RunningSummary />
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-3">
          {segments.length === 0 && !partial ? (
            <EmptyState recording={isRecording(status)} />
          ) : (
            <ol className="space-y-1">
              {segments.map((s) => (
                <li
                  key={highlight?.segmentId === s.id ? `${s.id}-${highlight.at}` : s.id}
                  id={`seg-${s.id}`}
                  className={`grid grid-cols-[3.25rem_1fr] gap-2 rounded-lg px-2 py-1.5 ${highlight?.segmentId === s.id ? "animate-flash" : ""}`}
                >
                  <time className="pt-0.5 font-mono text-xs text-zinc-400 tabular-nums">{formatClock(s.startMs)}</time>
                  <p className="text-[15px] leading-relaxed">
                    {s.speaker && <span className={`mr-1.5 text-xs font-semibold ${speakerColor(s.speaker)}`}>{speakerName(s.speaker)}</span>}
                    {s.text}
                  </p>
                </li>
              ))}
              {partial && (
                <li className="grid grid-cols-[3.25rem_1fr] gap-2 px-2 py-1.5">
                  <span className="pt-0.5 font-mono text-xs text-zinc-300 dark:text-zinc-600">live</span>
                  <p className="text-[15px] leading-relaxed text-zinc-400 dark:text-zinc-500">
                    {partial.speaker && <span className={`mr-1.5 text-xs font-semibold opacity-70 ${speakerColor(partial.speaker)}`}>{speakerName(partial.speaker)}</span>}
                    {partial.text}
                    <span className="ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 animate-pulse bg-zinc-400" />
                  </p>
                </li>
              )}
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
