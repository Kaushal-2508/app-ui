import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  BookOpen,
  Building2,
  CalendarDays,
  Layers,
  Megaphone,
  School,
  Users,
} from "lucide-react";
import {
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isThisYear,
  isToday,
  isYesterday,
} from "date-fns";

import type { Tone } from "@/components/shared/design-system";

/** Visual identity of a notice type: the icon in the leading disc and the
 *  tone that tints it. One place, so cards, sheet and pane never disagree. */
export interface NoticeTypeMeta {
  label: string;
  icon: LucideIcon;
  tone: Tone;
}

const TYPE_META: Record<string, NoticeTypeMeta> = {
  general: { label: "General", icon: Megaphone, tone: "teal" },
  academic: { label: "Academic", icon: BookOpen, tone: "violet" },
  event: { label: "Event", icon: CalendarDays, tone: "peach" },
  ptm: { label: "PTM", icon: Users, tone: "sky" },
};

export function noticeTypeMeta(type: string): NoticeTypeMeta {
  return TYPE_META[type] ?? TYPE_META.general;
}

export const NOTICE_TYPE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All types" },
  { value: "general", label: "General" },
  { value: "academic", label: "Academic" },
  { value: "event", label: "Event" },
  { value: "ptm", label: "PTM" },
];

export interface NoticePriorityMeta {
  label: string;
  tone: Tone;
  icon?: LucideIcon;
}

const PRIORITY_META: Record<string, NoticePriorityMeta | null> = {
  urgent: { label: "Urgent", tone: "rose", icon: AlertTriangle },
  important: { label: "Important", tone: "peach" },
  normal: null,
};

/** Returns null for a normal notice: an unlabelled row IS the normal state,
 *  and stamping "Normal" on every card would drown the two that matter. */
export function noticePriorityMeta(priority: string): NoticePriorityMeta | null {
  return PRIORITY_META[priority] ?? null;
}

const SCOPE_META: Record<string, { label: string; icon: LucideIcon }> = {
  institution: { label: "Whole school", icon: School },
  wing: { label: "Wing", icon: Building2 },
  class: { label: "Class", icon: Layers },
};

export function noticeScopeMeta(scope: string) {
  return SCOPE_META[scope] ?? SCOPE_META.institution;
}

/** Short, glanceable timestamp for a list row: "Just now", "35m ago",
 *  "3h ago", "Yesterday", "Mon", "3 Sep", "3 Sep 2025". Falls back to a
 *  fixed date once a week has passed, since "12 days ago" is harder to place
 *  than the date itself. */
export function formatNoticeDate(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mins = differenceInMinutes(now, d);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (isToday(d)) return `${Math.floor(mins / 60)}h ago`;
  if (isYesterday(d)) return "Yesterday";
  if (differenceInCalendarDays(now, d) < 7) return format(d, "EEE");
  return isThisYear(d) ? format(d, "d MMM") : format(d, "d MMM yyyy");
}

/** Full timestamp for the detail header. */
export function formatNoticeDateLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return format(d, "EEE, d MMM yyyy · h:mm a");
}

export type NoticeDateGroup = "Today" | "Yesterday" | "This week" | "Earlier";

export function noticeDateGroup(iso: string, now: Date = new Date()): NoticeDateGroup {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Earlier";
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  if (differenceInCalendarDays(now, d) < 7) return "This week";
  return "Earlier";
}

const GROUP_ORDER: NoticeDateGroup[] = ["Today", "Yesterday", "This week", "Earlier"];

/** Buckets already-sorted rows (newest first) into date groups, preserving
 *  order. Display grouping of loaded rows only: no counting, no fetching.
 *  `getDate` picks the timestamp so the School Diary can share it. */
export function groupNoticesByDate<T>(
  rows: T[],
  getDate: (row: T) => string,
): { group: NoticeDateGroup; rows: T[] }[] {
  const now = new Date();
  const buckets = new Map<NoticeDateGroup, T[]>();
  for (const row of rows) {
    const g = noticeDateGroup(getDate(row), now);
    const list = buckets.get(g);
    if (list) list.push(row);
    else buckets.set(g, [row]);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    rows: buckets.get(g) ?? [],
  }));
}

/** "Valid until" copy, or null when the notice never expires. Flags expiry
 *  within 48 hours so a card can warn before the notice silently vanishes
 *  from the inbox. */
export function expiryMeta(
  expiresAt: string | null,
  now: Date = new Date(),
): { label: string; soon: boolean } | null {
  if (!expiresAt) return null;
  const d = new Date(expiresAt);
  if (Number.isNaN(d.getTime())) return null;
  const days = differenceInCalendarDays(d, now);
  if (days <= 0) return { label: "Expires today", soon: true };
  if (days === 1) return { label: "Expires tomorrow", soon: true };
  return { label: `Valid until ${format(d, "d MMM")}`, soon: false };
}

/** Drives the width of the reach bar only; no percentage is shown as text. */
export function percentOf(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 100);
}
