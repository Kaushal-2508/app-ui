import type { LucideIcon } from "lucide-react";
import { BellRing, BookOpen, MessageSquareWarning, NotebookPen, Trophy } from "lucide-react";
import { differenceInCalendarDays, format, isToday, isTomorrow } from "date-fns";

import type { Tone } from "@/components/shared/design-system";
import type { DiaryKind } from "@/hooks/diary";

/** What each kind of entry is, in the words a teacher and a family use. The
 *  `hint` sits under the kind picker; the `titlePlaceholder` and
 *  `bodyPlaceholder` teach by example instead of instruction. */
export interface DiaryKindMeta {
  value: DiaryKind;
  label: string;
  icon: LucideIcon;
  tone: Tone;
  hint: string;
  titlePlaceholder: string;
  bodyPlaceholder: string;
}

export const DIARY_KIND_META: Record<DiaryKind, DiaryKindMeta> = {
  homework: {
    value: "homework",
    label: "Homework",
    icon: BookOpen,
    tone: "teal",
    hint: "Work to finish at home, with a due date.",
    titlePlaceholder: "Maths: exercise 4.2, questions 1 to 10",
    bodyPlaceholder: "Show working for every question. We will check it in class on Monday.",
  },
  remark: {
    value: "remark",
    label: "Remark",
    icon: MessageSquareWarning,
    tone: "rose",
    hint: "A concern or complaint about behaviour or work, for the family to see.",
    titlePlaceholder: "Incomplete classwork this week",
    bodyPlaceholder: "Aarav has not completed classwork on three days this week. Please talk to him about it.",
  },
  reminder: {
    value: "reminder",
    label: "Reminder",
    icon: BellRing,
    tone: "peach",
    hint: "Something to bring, sign or remember.",
    titlePlaceholder: "Bring the consent form on Friday",
    bodyPlaceholder: "The field trip consent form goes home today. Please sign and return it by Friday.",
  },
  appreciation: {
    value: "appreciation",
    label: "Appreciation",
    icon: Trophy,
    tone: "mint",
    hint: "Good work or good conduct worth telling home about.",
    titlePlaceholder: "Excellent science project",
    bodyPlaceholder: "Priya presented her project with real confidence today. Well done.",
  },
  note: {
    value: "note",
    label: "Note",
    icon: NotebookPen,
    tone: "sky",
    hint: "Anything else that belongs in the diary.",
    titlePlaceholder: "Library books due back",
    bodyPlaceholder: "Library books issued in August are due back this week.",
  },
};

export const DIARY_KIND_LIST: DiaryKindMeta[] = [
  DIARY_KIND_META.homework,
  DIARY_KIND_META.remark,
  DIARY_KIND_META.reminder,
  DIARY_KIND_META.appreciation,
  DIARY_KIND_META.note,
];

export function diaryKindMeta(kind: string): DiaryKindMeta {
  return DIARY_KIND_META[kind as DiaryKind] ?? DIARY_KIND_META.note;
}

/** "Due today", "Due tomorrow", "Due Mon 9 Sep", or "Was due 3 Sep" once the
 *  date has passed. `overdue` lets the chip change tone. */
export function dueLabel(
  dueDate: string | null,
  now: Date = new Date(),
): { label: string; overdue: boolean } | null {
  if (!dueDate) return null;
  const d = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const days = differenceInCalendarDays(d, now);
  if (days < 0) return { label: `Was due ${format(d, "d MMM")}`, overdue: true };
  if (isToday(d)) return { label: "Due today", overdue: false };
  if (isTomorrow(d)) return { label: "Due tomorrow", overdue: false };
  if (days < 7) return { label: `Due ${format(d, "EEE d MMM")}`, overdue: false };
  return { label: `Due ${format(d, "d MMM")}`, overdue: false };
}

/** Today's date as the yyyy-mm-dd string a date input wants, in local time. */
export function todayInputValue(now: Date = new Date()): string {
  return format(now, "yyyy-MM-dd");
}
