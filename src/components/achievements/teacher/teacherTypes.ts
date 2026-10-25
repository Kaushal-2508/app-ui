/**
 * Row shapes for the teacher Achievements payload.
 *
 * Declared here rather than in the hook for the same reason the student shapes
 * live in ../types: there is exactly ONE definition of each row, and the
 * components consume it without importing the hook (which would pull react-query
 * and the supabase client into every chunk that touches a teacher badge, §23).
 * `useTeacherAchievements` should import `TeacherAchievements` from here and
 * return it, not redeclare it.
 */

import type {
  BadgeProgressShape,
  CumulativeMetric,
  EarnedBadgeShape,
  ShieldTier,
} from "../types";
import type { TeacherAchievementCategory } from "./teacherCategories";

/**
 * The eighteen metrics behind the live teacher catalog, and the ONLY metrics a
 * teacher badge may be built on. Each is a plain running count:
 *
 *   attendance_days_marked     COUNT(DISTINCT attendance_records.date) WHERE marked_by = teacher
 *   lessons_taught             COUNT(*) tt_lesson_plans WHERE owner_teacher_id = teacher
 *                                AND status = 'done' AND session_type = 'teaching'
 *   exams_created              COUNT(*) exams WHERE created_by = teacher
 *   answers_evaluated          COUNT(*) teacher_overrides WHERE evaluated_by = teacher
 *                                AND NOT COALESCE(accepted_ai_suggestion, false)
 *   homework_created           COUNT(*) homework_assignments WHERE created_by = teacher
 *   homework_marked            COUNT(*) homework_assignments WHERE evaluated_by = teacher
 *   tasks_completed            COUNT(*) task_assignments ta JOIN tasks tk ON tk.id = ta.task_id
 *                                WHERE ta.assignee_id = teacher AND tk.status = 'completed'
 *   lessons_planned_ahead      COUNT(*) tt_lesson_plans WHERE owner_teacher_id = teacher
 *                                AND (planned_at AT TIME ZONE institution.timezone)::date < date
 *                                AND session_type = 'teaching' AND NOT is_note_only
 *                                AND topic_id IS NOT NULL
 *   syllabus_topics_completed  COUNT(DISTINCT syllabus_progress_events.topic_id)
 *                                WHERE recorded_by = teacher AND action = 'completed'
 *   exams_published            COUNT(*) exams WHERE created_by = teacher
 *                                AND status IN ('published','active','completed')
 *   questions_authored         COUNT(*) question_bank WHERE created_by = teacher AND source = 'manual'
 *   ai_questions_saved         COUNT(*) question_bank WHERE created_by = teacher AND source = 'ai_generated'
 *   templates_created          COUNT(*) exam_templates WHERE created_by = teacher
 *   templates_shared           COUNT(*) exam_templates WHERE created_by = teacher AND is_shared
 *   results_published          COUNT(DISTINCT student_exam_attempts.exam_id) via final_results
 *                                WHERE finalized_by = teacher OR published_by = teacher
 *   students_remarked          COUNT(DISTINCT student_remarks.student_id) WHERE teacher_id = teacher
 *   substitutions_covered      COUNT(*) tt_substitutions WHERE substitute_teacher_id = teacher
 *                                AND status IN ('assigned','completed')
 *   leave_reviews_done         COUNT(*) leave_requests WHERE reviewed_by = teacher
 *                                AND status IN ('approved','rejected') AND source = 'student'
 *
 * attendance_days_marked counts DISTINCT DATES, never attendance_records rows:
 * marking one class of 40 is one day of work, not 40. syllabus_topics_completed
 * likewise counts DISTINCT chapters: the same chapter completed for two sections
 * is one chapter. lessons_planned_ahead compares planned_at in the INSTITUTION's
 * timezone (CLAUDE.md §24), never UTC.
 *
 * "Teacher" here includes coordinators: since 20260904150000 the evaluator's
 * role guard admits user_roles.role IN ('teacher', 'coordinator'), and the
 * achievements page routes both roles to this surface.
 *
 * answers_evaluated excludes rows where the AI's mark was accepted as-is, which
 * is 90% of teacher_overrides (6,998 of 7,755 rows on 2026-08-18). The
 * discriminator is accepted_ai_suggestion, NOT is_auto_graded: the auto-grader
 * writes evaluated_by = the caller who pressed the button, so is_auto_graded
 * would still count the 110 bulk-accepts as marking while discarding the 18
 * cases where a teacher genuinely overrode an AI grade. Counting the raw rows
 * would have awarded platinum "Marking Machine" to teachers who hand-marked
 * nothing.
 *
 * `student_improvement_percent` and `tasks_on_time` are deliberately absent.
 * Their badges (Student Mentor, Impact Creator, Speed Demon) are deactivated
 * because neither number is computed anywhere: the first never has been, and
 * the second needs a completion timestamp that `tasks` does not carry, so "on
 * time" cannot be determined honestly. Do not add either back without the
 * computation landing first.
 */
export const TEACHER_METRIC_LIST = [
  "attendance_days_marked",
  "lessons_taught",
  "exams_created",
  "answers_evaluated",
  "homework_created",
  "homework_marked",
  "tasks_completed",
  "lessons_planned_ahead",
  "syllabus_topics_completed",
  "exams_published",
  "questions_authored",
  "ai_questions_saved",
  "templates_created",
  "templates_shared",
  "results_published",
  "students_remarked",
  "substitutions_covered",
  "leave_reviews_done",
] as const;

export type TeacherMetric = (typeof TEACHER_METRIC_LIST)[number];

/** True when a raw `criteria_metric` is one of the locked teacher metrics. */
export function isTeacherMetric(metric: string): metric is TeacherMetric {
  return (TEACHER_METRIC_LIST as readonly string[]).includes(metric);
}

/**
 * Membership test, and the compile-time proof that ties this file to the shared
 * contract: the annotation is `ReadonlySet<CumulativeMetric>` while the value is
 * a `Set<TeacherMetric>`, so dropping any teacher metric from
 * `CUMULATIVE_METRIC_LIST` in ../types fails typecheck here rather than silently
 * degrading a teacher badge from a progress bar to a bare event line.
 */
export const TEACHER_CUMULATIVE_METRICS: ReadonlySet<CumulativeMetric> =
  new Set<TeacherMetric>(TEACHER_METRIC_LIST);

/** One row of `badge_definitions` for `badge_type='teacher'`. */
export interface TeacherBadgeShape {
  id: string;
  name: string;
  description: string | null;
  icon_name: string;
  category: TeacherAchievementCategory;
  tier: ShieldTier;
  points: number;
  /**
   * `'count'` for every live teacher badge. Typed as `string` rather than the
   * literal so an unfamiliar row degrades through `toBadgeDisplay`'s fallback
   * instead of failing to parse.
   */
  criteria_type: string;
  /** A `TeacherMetric` in practice; see the note on `criteria_type`. */
  criteria_metric: string;
  criteria_value: number;
  display_order: number;
}

/**
 * The whole teacher Achievements payload, in ONE round trip.
 *
 * There is NO `streak` field and there must not be one. `user_activity_log` is
 * written for students only, so there is no teacher activity spine to compute a
 * streak from; a teacher streak here would be a number with nothing behind it.
 * The surface renders no streak card for the same reason.
 */
export interface TeacherAchievements {
  points: number;
  rank: ShieldTier;
  /** Points needed for the next rank, or null at the top. */
  next_rank_at: number | null;
  catalog: TeacherBadgeShape[];
  /**
   * An ARRAY for symmetry with the student payload. No teacher badge is
   * periodic, so in practice there is at most one row per badge and
   * `period_key` is always null.
   */
  earned: EarnedBadgeShape[];
  /** badge_id -> cumulative progress, written server-side. */
  progress: Record<string, BadgeProgressShape>;
}
