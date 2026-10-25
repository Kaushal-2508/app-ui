// src/hooks/olympiad/useOlympiadCashEnroll.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type CashEnrollInput = {
  oly_school_id: string;
  form_data: {
    full_name: string;
    date_of_birth: string;
    class_label: string;
    section_label?: string | null;
    grade_level_id: string;
    admission_number?: string | null;
    profile_id?: string | null;
    subject_ids: string[];
    parent_name: string;
    parent_phone: string;
    parent_email?: string | null;
    fee_collected: boolean;
  };
};

export type CashEnrollResult =
  | { oly_student_id: string; roll_number: string; login_ready?: boolean; blocked?: false }
  | { blocked: true; message: string };

export function useOlympiadCashEnroll() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CashEnrollInput): Promise<CashEnrollResult> => {
      try {
        return await invokeEdgeFunction<{ oly_student_id: string; roll_number: string; login_ready?: boolean }>(
          "oly-cash-enroll",
          input,
        );
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("Already enrolled")) {
          return { blocked: true, message: msg };
        }
        throw e;
      }
    },
    onSuccess: (result) => {
      // Discriminate on the success-only field so TS narrows `result` to the
      // enrolled variant (the blocked variant has no oly_student_id/roll_number).
      if (!("oly_student_id" in result)) return;
      queryClient.invalidateQueries({ queryKey: ["olympiad", "class-roster"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "school-students"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "batching-roster"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "my-classes"] });
      queryClient.invalidateQueries({ queryKey: ["olympiad", "salci-roster"] });
      toast.success(`Student enrolled. Roll number: ${result.roll_number}`);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't enroll student.", context: "useOlympiadCashEnroll" }),
  });
}
