import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";

export interface OptionalOfferedSubject {
  subject_id: string;
  name: string;
  enrolled: boolean;
  enrollment_id: string | null;
}

export interface StudentSubjectAssignment {
  can_manage: boolean;
  compulsory: { subject_id: string; name: string }[];
  optional_offered: OptionalOfferedSubject[];
}

/**
 * Reads a student's subject picture for the ViewUserSheet "Subjects" tab:
 * compulsory subjects (locked context) + every optional subject offered to
 * their class with the student's enrolled state. Server resolves everything
 * via `get_student_subject_assignment` (SECURITY DEFINER, view-permission gated).
 */
export function useStudentSubjectAssignment(studentId: string | null) {
  return useQuery({
    queryKey: ["student-subject-assignment", studentId],
    queryFn: async (): Promise<StudentSubjectAssignment> => {
      const { data, error } = await supabase.rpc("get_student_subject_assignment", {
        _student: studentId as string,
      });
      if (error) throw error;
      const obj = (data ?? {}) as unknown as Partial<StudentSubjectAssignment>;
      return {
        can_manage: obj.can_manage ?? false,
        compulsory: obj.compulsory ?? [],
        // The RPC still returns a vestigial `classification` per row (always
        // 'main' since 20260730120000) — deliberately dropped here.
        optional_offered: obj.optional_offered ?? [],
      };
    },
    enabled: !!studentId,
    staleTime: 60_000,
  });
}

/**
 * Returns the set of subject ids a student actually sees (compulsory ∪ enrolled
 * optionals) via the centralising `student_visible_subject_ids` helper. Used by
 * client-side filtering paths (timetable, study materials) in later phases.
 */
export function useStudentVisibleSubjects(studentId: string | null) {
  return useQuery({
    queryKey: ["student-visible-subjects", studentId],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase.rpc("student_visible_subject_ids", {
        _student: studentId as string,
      });
      if (error) throw error;
      return new Set<string>((data ?? []) as string[]);
    },
    enabled: !!studentId,
    staleTime: 60_000,
  });
}

/**
 * Enrolls / un-enrolls a student in an optional subject (soft toggle via
 * is_active). Upserts on (student_id, subject_id). RLS enforces that only
 * admins / wing-scoped coordinators can write.
 *
 * DORMANT since 2026-07-29: the per-subject toggle UI was removed from
 * StudentSubjectsTab — enrollment now goes through Optional Groups
 * (useSaveStudentOptionalGroupChoices). Kept as the underlying primitive;
 * don't wire it into new UI without checking the group model first.
 */
export function useToggleStudentEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      studentId: string;
      subjectId: string;
      subjectName?: string;
      enrolled: boolean;
      institutionId: string;
      classId?: string | null;
    }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const actorId = sessionData.session?.user?.id ?? null;

      const { error } = await supabase
        .from("student_optional_enrollments")
        .upsert(
          {
            student_id: input.studentId,
            subject_id: input.subjectId,
            class_id: input.classId ?? null,
            institution_id: input.institutionId,
            is_active: input.enrolled,
            assigned_by: actorId,
          },
          { onConflict: "student_id,subject_id" },
        );
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["student-subject-assignment", input.studentId] });
      queryClient.invalidateQueries({ queryKey: ["student-visible-subjects", input.studentId] });
      // Downstream student-facing caches (filtered from P3 onward).
      queryClient.invalidateQueries({ queryKey: ["student-eligible-exams"] });
      queryClient.invalidateQueries({ queryKey: ["student-results"] });
      queryClient.invalidateQueries({ queryKey: ["student-homework"] });
      toast.success(input.enrolled ? "Subject enrolled" : "Subject removed");
      void logActivityEvent({
        action: input.enrolled ? "optional_subject_enrolled" : "optional_subject_unenrolled",
        entityType: "StudentOptionalSubject",
        entityId: input.studentId,
        entityName: input.subjectName,
        metadata: { subject_id: input.subjectId, institution_id: input.institutionId },
      });
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't update this student's optional subjects.",
        context: "toggleStudentEnrollment",
      }),
  });
}

// The main/optional classification was RETIRED 2026-07-30: every optional
// subject a student picks counts as a MAIN subject. `useSetOptionalClassification`
// (writer) and `useMyOptionalClassifications` (reader for the study-materials
// badge) were deleted along with the UI. The DB column is pinned to 'main'
// by CHECK (migration 20260730120000) — do not reintroduce a writer.
