import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useStudentFees(institutionId: string | undefined) {
  const queryClient = useQueryClient();

  const assignmentsQuery = useQuery({
    queryKey: ["student-fee-assignments", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("student_fee_assignments")
        .select("*, profiles!student_fee_assignments_student_id_fkey(full_name, email), fee_structures(amount, frequency, academic_year, fee_categories(name))")
        .eq("institution_id", institutionId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const assignFees = useMutation({
    mutationFn: async (assignments: {
      student_id: string;
      fee_structure_id: string;
      discount_amount?: number;
      discount_reason?: string;
      total_amount: number;
    }[]) => {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const rows = assignments.map(a => ({
        ...a,
        institution_id: institutionId!,
        assigned_by: userId!,
      }));
      const { data, error } = await supabase.from("student_fee_assignments").insert(rows).select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-fee-assignments"] });
      toast.success("Fees assigned successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { assignments: assignmentsQuery.data ?? [], isLoading: assignmentsQuery.isLoading, assignFees };
}

export function useStudentInstallments(institutionId: string | undefined) {
  const queryClient = useQueryClient();

  const installmentsQuery = useQuery({
    queryKey: ["fee-installments", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_installments")
        .select("*, profiles!fee_installments_student_id_fkey(full_name, email)")
        .eq("institution_id", institutionId!)
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const createInstallments = useMutation({
    mutationFn: async (installments: {
      assignment_id: string;
      student_id: string;
      installment_number: number;
      amount: number;
      due_date: string;
    }[]) => {
      const rows = installments.map(i => ({ ...i, institution_id: institutionId! }));
      const { data, error } = await supabase.from("fee_installments").insert(rows).select();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-installments"] });
      toast.success("Installments generated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { installments: installmentsQuery.data ?? [], isLoading: installmentsQuery.isLoading, createInstallments };
}
