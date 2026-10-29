"use client";
import { ShieldCheck } from "lucide-react";
import { useMeeting } from "@/store/meeting";

export default function ConsentBanner() {
  const dismissed = useMeeting((s) => s.settings.consentDismissed);
  const setSettings = useMeeting((s) => s.setSettings);
  if (dismissed) return null;
  return (
    <div className="mx-3 mt-3 flex flex-col gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm text-indigo-950 sm:mx-4 sm:flex-row sm:items-center dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-100">
      <ShieldCheck className="hidden h-4 w-4 shrink-0 sm:block" />
      <p className="flex-1">
        <strong>Ask before you record.</strong> Get consent from everyone in the meeting first. Audio is streamed for live
        transcription and is not stored on our server; your transcript stays in this browser.
      </p>
      <button
        onClick={() => setSettings({ consentDismissed: true })}
        className="self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 sm:self-auto"
      >
        Got it
      </button>
    </div>
  );
}
