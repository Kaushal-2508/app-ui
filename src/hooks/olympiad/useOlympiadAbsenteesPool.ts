import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AbsenteesStudent = {
  id: string;
  roll_number: string;
  full_name: string;
  class_label: string;
  grade_level_id: string | null;
  reason: "no_assignment" | "batch_cancelled";
};

export function useOlympiadAbsenteesPool(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "absentees-pool", olySchoolId],
    queryFn: async (): Promise<AbsenteesStudent[]> => {
      if (!olySchoolId) return [];

      // Students with no batch assignment
      const { data: students } = await supabase
        .from("oly_students")
        .select("id, roll_number, full_name, class_label, grade_level_id, status")
        .eq("oly_school_id", olySchoolId)
        .eq("status", "active");

      const studentIds = (students ?? []).map((s) => s.id);
      if (studentIds.length === 0) return [];

      const { data: assignments } = await supabase
        .from("oly_batch_assignments")
        .select("oly_student_id, oly_batches!oly_batch_id(status)")
        .in("oly_student_id", studentIds);

      // Collect ALL statuses per student — a student may have both a cancelled
      // and an active/locked assignment; overwriting would misclassify them.
      const statusesByStudent = new Map<string, string[]>();
      for (const a of assignments ?? []) {
        const batch = Array.isArray(a.oly_batches) ? a.oly_batches[0] : a.oly_batches;
        const status = (batch as { status?: string } | null)?.status ?? "";
        const arr = statusesByStudent.get(a.oly_student_id) ?? [];
        arr.push(status);
        statusesByStudent.set(a.oly_student_id, arr);
      }

      const absentees: AbsenteesStudent[] = [];
      for (const s of students ?? []) {
        const statuses = statusesByStudent.get(s.id);
        if (!statuses || statuses.length === 0) {
          // No assignment at all
          absentees.push({ ...s, reason: "no_assignment" });
        } else if (statuses.every((st) => st === "cancelled")) {
          // All assignments cancelled — student is effectively absent
          absentees.push({ ...s, reason: "batch_cancelled" });
        }
        // Otherwise the student has at least one non-cancelled assignment — not absent
      }
      return absentees;
    },
    enabled: !!olySchoolId,
    staleTime: 60_000,
  });
}
