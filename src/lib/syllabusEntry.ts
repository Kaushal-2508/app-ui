import { format } from "date-fns";

/**
 * "Entered 16 Sep" when a log for `lessonDate` (YYYY-MM-DD) was typed in on a
 * later day, else null. A back-filled day otherwise reads exactly like one
 * logged at the bell. Uses the device's local date, the same IST-only
 * convention the week page uses for "today" (CLAUDE.md §24 note).
 */
export function enteredLateLabel(createdAt: string | null | undefined, lessonDate: string): string | null {
  if (!createdAt) return null;
  const entered = new Date(createdAt);
  if (Number.isNaN(entered.getTime())) return null;
  if (format(entered, "yyyy-MM-dd") <= lessonDate) return null;
  return `Entered ${format(entered, "d MMM")}`;
}

/**
 * The one order for every chapter picker: the syllabus's own display_order
 * (book order for most subjects), then the name, compared the way people read
 * it ("Chapter 2" before "Chapter 10"). Chapters a teacher added themselves all
 * carry display_order 1, so among themselves they sort by name.
 */
export function compareChapterOrder(
  a: { order: number | null | undefined; name: string },
  b: { order: number | null | undefined; name: string },
): number {
  const ao = a.order ?? Number.MAX_SAFE_INTEGER;
  const bo = b.order ?? Number.MAX_SAFE_INTEGER;
  if (ao !== bo) return ao - bo;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
