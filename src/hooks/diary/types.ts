/** Shared types for the School Diary.
 *
 *  Mirrors the RPC contract in
 *  docs/superpowers/specs/2026-09-07-school-diary-design.md. The database half
 *  is NEEDS DB (Tushar); until it lands the feature stays behind the
 *  `school_diary` institution flag, so nothing here is reachable in prod. */

export type DiaryKind = "homework" | "remark" | "reminder" | "appreciation" | "note";

/**
 * True when the server answered "no such function". PostgREST reports a
 * missing RPC as PGRST202 ("Could not find the function public.diary_feed…"),
 * which is exactly the state a school is in when the `school_diary` flag has
 * been switched on before the diary migration was applied. Callers turn that
 * into an honest "not set up yet" message instead of "something went wrong".
 */
export function isDiaryUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: unknown; message?: unknown };
  if (e.code === "PGRST202") return true;
  return (
    typeof e.message === "string" &&
    /could not find the function public\.diary_/i.test(e.message)
  );
}

export const DIARY_UNAVAILABLE_MESSAGE =
  "The School Diary isn't available on the server yet. Entries will work once the update is applied.";

export const DIARY_KINDS: DiaryKind[] = ["homework", "remark", "reminder", "appreciation", "note"];

/** One diary entry as returned by `diary_feed`. Addressed to a whole class
 *  when `student_id` is null, otherwise to exactly one student. */
export interface DiaryEntry {
  id: string;
  class_id: string;
  class_label: string;
  student_id: string | null;
  student_name: string | null;
  kind: DiaryKind | string;
  title: string;
  body: string;
  /** Homework only. ISO date, no time. */
  due_date: string | null;
  /** The institution-local day the entry belongs to. ISO date. */
  entry_date: string;
  created_at: string;
  author_id: string;
  author_name: string | null;
  /** Server-decided: the author, or an admin of the institution. */
  can_manage: boolean;
}

export interface DiaryFeedFilters {
  classId?: string | null;
  studentId?: string | null;
  kind?: DiaryKind | null;
}

/** Payload for `diary_write_entry`. `entryId` is generated client-side so a
 *  double-submit is idempotent. */
export interface WriteDiaryEntryInput {
  entryId: string;
  classId: string;
  /** Null or omitted addresses the whole class. */
  studentId?: string | null;
  kind: DiaryKind;
  title: string;
  body: string;
  /** Homework only. ISO date (yyyy-mm-dd). */
  dueDate?: string | null;
}

/** Payload for `diary_write_entries`: the same entry for two or more students
 *  of one class, saved as one copy per student in a single transaction.
 *  `entryIds[i]` is the id of `studentIds[i]`'s copy, generated client-side so
 *  a double-submit or a retry is idempotent per copy. The RPC is live since
 *  20261001120000; contract in docs/superpowers/specs/2026-09-07-school-diary-design.md. */
export interface WriteDiaryEntriesInput {
  entryIds: string[];
  classId: string;
  studentIds: string[];
  kind: DiaryKind;
  title: string;
  body: string;
  /** Homework only. ISO date (yyyy-mm-dd). */
  dueDate?: string | null;
}

export const DIARY_MULTI_UNAVAILABLE_MESSAGE =
  "Writing for several students at once isn't on the server yet, so nothing was saved. Choose one student or the whole class for now.";
