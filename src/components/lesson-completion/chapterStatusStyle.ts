import { Check, Circle, CircleDot, NotebookPen, type LucideIcon } from "lucide-react";

export type ChapterTagStatus = "completed" | "partial" | "untouched" | "logged-today";

/**
 * One look for a chapter's status in every chapter list: green Completed,
 * yellow In progress, red Not started, as a tinted row plus a solid pill with
 * an icon, so status reads at a glance. Light and dark are both spelled out.
 * Kept out of ChapterStatusTag.tsx so that file exports only components
 * (react-refresh/only-export-components).
 */
export const CHAPTER_STATUS_STYLE: Record<ChapterTagStatus, { label: string; icon: LucideIcon; pill: string; row: string }> = {
  completed: {
    label: "Completed",
    icon: Check,
    pill: "bg-emerald-600 text-white dark:bg-emerald-500 dark:text-emerald-950",
    row: "bg-emerald-50 text-emerald-950 focus:bg-emerald-100 focus:text-emerald-950 dark:bg-emerald-500/10 dark:text-emerald-50 dark:focus:bg-emerald-500/20 dark:focus:text-emerald-50",
  },
  // Yellow carries dark text: white on yellow is unreadable in either theme.
  partial: {
    label: "In progress",
    icon: CircleDot,
    pill: "bg-yellow-400 text-yellow-950 dark:bg-yellow-400 dark:text-yellow-950",
    row: "bg-yellow-50 text-yellow-950 focus:bg-yellow-100 focus:text-yellow-950 dark:bg-yellow-400/10 dark:text-yellow-50 dark:focus:bg-yellow-400/20 dark:focus:text-yellow-50",
  },
  untouched: {
    label: "Not started",
    icon: Circle,
    pill: "bg-rose-600 text-white dark:bg-rose-500 dark:text-white",
    row: "bg-rose-50 text-rose-950 focus:bg-rose-100 focus:text-rose-950 dark:bg-rose-500/10 dark:text-rose-50 dark:focus:bg-rose-500/20 dark:focus:text-rose-50",
  },
  "logged-today": {
    label: "Logged for this day",
    icon: NotebookPen,
    pill: "bg-ink-400/20 text-ink-700",
    row: "",
  },
};

/** Row tint for a chapter status, for lists that are not a Select (sheets, the syllabus page). */
export const CHAPTER_ROW_TINT: Record<ChapterTagStatus, string> = {
  completed: "bg-emerald-50 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30",
  partial: "bg-yellow-50 border-yellow-300 dark:bg-yellow-400/10 dark:border-yellow-400/30",
  untouched: "bg-rose-50 border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/30",
  "logged-today": "",
};
