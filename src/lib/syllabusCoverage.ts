import { supabase } from "@/integrations/supabase/client";
import { fetchCoveragePlans } from "@/lib/timetableCompat";

// -------------------------------------------------------------
// Syllabus coverage math — answers the question:
//   "For this class + subject, how many chapters have been
//    covered so far, and how much is pending?"
//
// A chapter is "covered" when at least one lesson_plan exists
// for any teacher of that class with:
//   status = 'done'
//   session_type = 'teaching'
//   topic_id = chapter.id
//
// Chapters come from the same source the exam flow uses:
// `topic_class_mappings` joined to `syllabus_topics` for the
// (class_id, subject_id), falling back to all active
// syllabus_topics for the subject when no class-scoped
// mappings exist — identical to useChaptersForExam so the two
// stay in sync.
//
// Pending and skipped counters surface topics the teacher has
// started and walked away from (at least one planned OR skipped
// row exists, but no done row yet). They are tallied on the
// lesson side, not the chapter side, so they do NOT double-count
// chapters that are also covered.
// -------------------------------------------------------------

export interface CoverageSummary {
  total: number;
  covered: number;
  pending: number;
  skipped: number;
  percentage: number;
}

export interface ChapterCoverageRow {
  chapter_id: string;
  topic_name: string;
  chapter_number: number | null;
  display_order: number | null;
  is_covered: boolean;
  is_pending: boolean;
  is_skipped: boolean;
  done_count: number;
  planned_count: number;
  skipped_count: number;
}

interface PlanStatusRow {
  topic_id: string;
  status: "planned" | "done" | "skipped";
  session_type: "teaching" | "test" | "doubt_session" | "other";
}

interface CoverageQueryParams {
  classId: string;
  subjectId: string;
  institutionId: string;
  /** Optional — when omitted, all plans regardless of academic year */
  academicYear?: string;
}

/**
 * Returns aggregate coverage numbers for the class+subject.
 * Thin wrapper over `getCoverageRowsForClassSubject` that
 * reduces the per-chapter rows into a single summary.
 */
export async function getCoverageForClassSubject(
  params: CoverageQueryParams,
): Promise<CoverageSummary> {
  const rows = await getCoverageRowsForClassSubject(params);
  return summarizeCoverage(rows);
}

/**
 * Per-chapter coverage rows, sorted by display_order then chapter_number.
 * Used by the lesson plan panel's syllabus browser and by the student's
 * coverage progress bars.
 */
export async function getCoverageRowsForClassSubject(
  params: CoverageQueryParams,
): Promise<ChapterCoverageRow[]> {
  const { classId, subjectId, academicYear } = params;

  const chapters = await fetchChapterOptions({ classId, subjectId });
  if (chapters.length === 0) return [];

  const chapterIds = chapters.map((c) => c.id);

  // Pull all lesson_plan status rows that touch these chapters via
  // the compat shim (reads tt_lesson_plans). RLS filters down to
  // what the caller is allowed to see; that's correct — students
  // shouldn't see skipped/pending/planned-but-skipped history, so
  // their coverage naturally excludes those.
  // academicYear kept on the signature for future cross-year views;
  // today the class_id scope is sufficient because each class row
  // is tied to a single academic year.
  void academicYear;
  const planRows = (await fetchCoveragePlans({
    classId,
    subjectId,
    chapterIds,
  })) as unknown as PlanStatusRow[];

  // Count by (topic_id, status) — only "teaching" sessions
  // contribute to coverage math. Doubt sessions and tests are
  // tracked elsewhere.
  const byChapter = new Map<
    string,
    { done: number; planned: number; skipped: number }
  >();
  for (const row of planRows) {
    if (row.session_type !== "teaching") continue;
    if (!row.topic_id) continue;
    const bucket = byChapter.get(row.topic_id) ?? {
      done: 0,
      planned: 0,
      skipped: 0,
    };
    if (row.status === "done") bucket.done += 1;
    else if (row.status === "planned") bucket.planned += 1;
    else if (row.status === "skipped") bucket.skipped += 1;
    byChapter.set(row.topic_id, bucket);
  }

  return chapters
    .map((c): ChapterCoverageRow => {
      const counts = byChapter.get(c.id) ?? {
        done: 0,
        planned: 0,
        skipped: 0,
      };
      const isCovered = counts.done > 0;
      // A chapter is "pending" when work has started or been skipped
      // but it isn't covered yet. Chapters with zero activity are
      // neither pending nor skipped — just untouched.
      const isSkipped = !isCovered && counts.skipped > 0;
      const isPending = !isCovered && counts.planned > 0;
      return {
        chapter_id: c.id,
        topic_name: c.topicName,
        chapter_number: c.chapterNumber,
        display_order: c.displayOrder,
        is_covered: isCovered,
        is_pending: isPending,
        is_skipped: isSkipped,
        done_count: counts.done,
        planned_count: counts.planned,
        skipped_count: counts.skipped,
      };
    })
    .sort((a, b) => {
      const d = (a.display_order ?? 999) - (b.display_order ?? 999);
      if (d !== 0) return d;
      return (a.chapter_number ?? 999) - (b.chapter_number ?? 999);
    });
}

export function summarizeCoverage(rows: ChapterCoverageRow[]): CoverageSummary {
  const total = rows.length;
  const covered = rows.filter((r) => r.is_covered).length;
  const pending = rows.filter((r) => r.is_pending).length;
  const skipped = rows.filter((r) => r.is_skipped).length;
  const percentage = total === 0 ? 0 : Math.round((covered / total) * 100);
  return { total, covered, pending, skipped, percentage };
}

// -------------------------------------------------------------
// Internal: mirrors useChaptersForExam. Kept in-module to avoid
// a hook dependency in pure-function library code.
// -------------------------------------------------------------
interface ChapterOptionRow {
  id: string;
  topicName: string;
  chapterNumber: number | null;
  displayOrder: number | null;
}

async function fetchChapterOptions(args: {
  classId: string;
  subjectId: string;
}): Promise<ChapterOptionRow[]> {
  const { classId, subjectId } = args;

  const { data: classRow } = await supabase
    .from("classes")
    .select("class_group_id")
    .eq("id", classId)
    .maybeSingle();

  const classGroupId =
    (classRow as { class_group_id: string | null } | null)?.class_group_id ?? null;

  const { data: mapped, error: mappedError } = classGroupId
    ? await supabase
        .from("topic_class_mappings")
        .select(
          "topic_id, syllabus_topics!inner(id, topic_name, chapter_number, display_order, is_active, subject_id)",
        )
        .eq("class_group_id", classGroupId)
    : { data: [] as unknown, error: null };

  if (mappedError) throw mappedError;

  type MappedRow = {
    syllabus_topics: {
      id: string;
      topic_name: string;
      chapter_number: number | null;
      display_order: number | null;
      is_active: boolean;
      subject_id: string;
    } | null;
  };

  const classScoped = ((mapped ?? []) as unknown as MappedRow[])
    .map((row) => row.syllabus_topics)
    .filter((t): t is NonNullable<typeof t> => !!t)
    .filter((t) => t.is_active && t.subject_id === subjectId)
    .map(
      (t): ChapterOptionRow => ({
        id: t.id,
        topicName: t.topic_name,
        chapterNumber: t.chapter_number,
        displayOrder: t.display_order,
      }),
    );

  if (classScoped.length > 0) return classScoped;

  const { data: all, error: allErr } = await supabase
    .from("syllabus_topics")
    .select("id, topic_name, chapter_number, display_order")
    .eq("subject_id", subjectId)
    .eq("is_active", true)
    .order("display_order");
  if (allErr) throw allErr;

  return (all ?? []).map(
    (t): ChapterOptionRow => ({
      id: t.id,
      topicName: t.topic_name,
      chapterNumber: t.chapter_number ?? null,
      displayOrder: t.display_order ?? null,
    }),
  );
}
