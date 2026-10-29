import { BookOpen, CircleHelp, Gavel, History, Lightbulb, ListTodo, SearchCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SuggestionType } from "@proass/shared";

export const TYPE_META: Record<SuggestionType, { icon: LucideIcon; badge: string; bar: string }> = {
  definition: { icon: BookOpen, badge: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", bar: "bg-sky-500" },
  background: { icon: History, badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", bar: "bg-violet-500" },
  fact_check: { icon: SearchCheck, badge: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300", bar: "bg-amber-500" },
  question_to_ask: { icon: CircleHelp, badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300", bar: "bg-emerald-500" },
  action_item: { icon: ListTodo, badge: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300", bar: "bg-rose-500" },
  decision: { icon: Gavel, badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", bar: "bg-indigo-500" },
  related_idea: { icon: Lightbulb, badge: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300", bar: "bg-teal-500" },
};

const SPEAKER_COLORS = [
  "text-sky-700 dark:text-sky-300",
  "text-rose-700 dark:text-rose-300",
  "text-emerald-700 dark:text-emerald-300",
  "text-amber-700 dark:text-amber-300",
  "text-violet-700 dark:text-violet-300",
  "text-teal-700 dark:text-teal-300",
];

export function speakerColor(label: string): string {
  let h = 0;
  for (const c of label) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPEAKER_COLORS[h % SPEAKER_COLORS.length]!;
}

export function IconButton({
  label,
  onClick,
  children,
  active,
  className = "",
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100 ${
        active ? "text-indigo-600 dark:text-indigo-400" : ""
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function Panel({ title, right, children }: { title: React.ReactNode; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-zinc-100 px-4 dark:border-zinc-800">
        <h2 className="flex items-center gap-2 text-sm font-semibold">{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}
