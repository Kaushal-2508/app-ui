import { Badge } from "@/components/ui/badge";

type Phase = "enrollment_open" | "enrollment_closed" | "batches_scheduled" | "exam_in_progress" | "results_published" | "archived";

const STYLE: Record<Phase, string> = {
  enrollment_open:    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300",
  enrollment_closed:  "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300",
  batches_scheduled:  "bg-sky-100 text-sky-900 dark:bg-sky-500/15 dark:text-sky-300",
  exam_in_progress:   "bg-violet-100 text-violet-900 dark:bg-violet-500/15 dark:text-violet-300",
  results_published:  "bg-slate-200 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300",
  archived:           "bg-slate-100 text-slate-600 dark:bg-slate-700/40 dark:text-slate-400",
};

const LABEL: Record<Phase, string> = {
  enrollment_open: "Enrollment Open",
  enrollment_closed: "Enrollment Closed",
  batches_scheduled: "Batches Scheduled",
  exam_in_progress: "Exam in Progress",
  results_published: "Results Published",
  archived: "Archived",
};

export function OlympiadPhasePill({ phase }: { phase: Phase }) {
  return <Badge className={`text-xs font-medium ${STYLE[phase]}`} variant="secondary">{LABEL[phase]}</Badge>;
}
