export type OlympiadStage = 1 | 2 | 3 | 4;

/**
 * Resolve where a school sits in the journey from its campaign status:
 * 1 Enroll → 2 Schedule → 3 Exam day → 4 Results. Enrollment counts as
 * effectively closed once the scheduled close time has passed, even if the
 * status row hasn't flipped yet. Single source of truth shared by the Shell's
 * stepper and the dashboard's What's Next card so they never disagree.
 */
export function resolveOlympiadStage(school: {
  status: "enrollment_open" | "enrollment_closed" | "batches_scheduled" | "exam_in_progress" | "results_published" | "archived";
  enrollment_closes_at: string | null;
}): OlympiadStage {
  const closesAt = school.enrollment_closes_at ? new Date(school.enrollment_closes_at) : null;
  const effectiveClosed =
    school.status === "enrollment_closed" ||
    (school.status === "enrollment_open" && closesAt !== null && Date.now() >= closesAt.getTime());
  if (school.status === "results_published" || school.status === "archived") return 4;
  if (school.status === "batches_scheduled" || school.status === "exam_in_progress") return 3;
  if (effectiveClosed) return 2;
  return 1;
}
