import type { NonSalciSchoolStatus } from "@/hooks/olympiad/useNonSalciSchools";

/** Human label + badge variant for an Olympiad school lifecycle status. */
export const OLYMPIAD_SCHOOL_STATUS: Record<
  NonSalciSchoolStatus,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  enrollment_open: { label: "Enrollment open", variant: "default" },
  enrollment_closed: { label: "Enrollment closed", variant: "secondary" },
  batches_scheduled: { label: "Batches scheduled", variant: "secondary" },
  exam_in_progress: { label: "Exam in progress", variant: "default" },
  results_published: { label: "Results published", variant: "outline" },
  archived: { label: "Archived", variant: "outline" },
};

export function olympiadSchoolStatusLabel(status: NonSalciSchoolStatus): string {
  return OLYMPIAD_SCHOOL_STATUS[status]?.label ?? status;
}
