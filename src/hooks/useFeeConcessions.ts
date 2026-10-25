import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useFeeConcessions(institutionId: string | undefined) {
  const queryClient = useQueryClient();

  const concessionsQuery = useQuery({
    queryKey: ["fee-concessions", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_concessions")
        .select("*, profiles!fee_concessions_student_id_fkey(full_name, email)")
        .eq("institution_id", institutionId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const createConcession = useMutation({
    mutationFn: async (values: {
      student_id: string;
      concession_type: string;
      percentage?: number;
      fixed_amount?: number;
      reason: string;
      valid_from: string;
      valid_to: string;
    }) => {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      const { data, error } = await supabase
        .from("fee_concessions")
        .insert({
          institution_id: institutionId!,
          student_id: values.student_id,
          concession_type: values.concession_type,
          percentage: values.percentage || null,
          fixed_amount: values.fixed_amount || null,
          reason: values.reason,
          approved_by: userId!,
          valid_from: values.valid_from,
          valid_to: values.valid_to,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-concessions"] });
      toast.success("Concession created successfully");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleConcession = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase
        .from("fee_concessions")
        .update({ is_active })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-concessions"] });
      toast.success("Concession updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return {
    concessions: concessionsQuery.data ?? [],
    isLoading: concessionsQuery.isLoading,
    createConcession,
    toggleConcession,
  };
}
