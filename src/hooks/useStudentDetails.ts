import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";

export interface StudentDetailsInput {
  studentId: string;
  fullName: string;
  rollNumber: string;
  admissionNumber: string;
  phone: string;
  dateOfBirth: string; // "YYYY-MM-DD" or ""
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string;
}

/**
 * Updates a student's profile fields + school-managed personal details in one
 * call via the `update_student_details` RPC, which validates roll-number
 * (per class) and admission-number (per institution) uniqueness and raises a
 * clear, student-naming error on conflict. Admin / wing-coordinator only
 * (enforced server-side).
 */
export function useUpdateStudentDetails() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: StudentDetailsInput) => {
      const { error } = await supabase.rpc("update_student_details", {
        _student: input.studentId,
        _full_name: input.fullName,
        _roll_number: input.rollNumber,
        _admission_number: input.admissionNumber,
        _phone: input.phone,
        _date_of_birth: input.dateOfBirth || null,
        _guardian_name: input.guardianName,
        _guardian_phone: input.guardianPhone,
        _guardian_email: input.guardianEmail,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["user-details", input.studentId] });
      queryClient.invalidateQueries({ queryKey: ["student-personal-details", input.studentId] });
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      toast.success("Student details updated");
      void logActivityEvent({
        action: "student_details_updated",
        entityType: "Student",
        entityId: input.studentId,
        entityName: input.fullName,
      });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the student's details.", context: "updateStudentDetails" }),
  });
}
