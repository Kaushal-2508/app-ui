import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useFeeDefaulters(institutionId: string | undefined) {
  const queryClient = useQueryClient();

  const defaultersQuery = useQuery({
    queryKey: ["fee-defaulters", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_installments")
        .select("*, profiles!fee_installments_student_id_fkey(full_name, email)")
        .eq("institution_id", institutionId!)
        .eq("status", "overdue")
        .order("due_date", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const applyLateFees = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("apply_late_fees", {
        _institution_id: institutionId!,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (count) => {
      queryClient.invalidateQueries({ queryKey: ["fee-defaulters"] });
      queryClient.invalidateQueries({ queryKey: ["fee-installments"] });
      toast.success(`Late fees applied to ${count} installments`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { defaulters: defaultersQuery.data ?? [], isLoading: defaultersQuery.isLoading, applyLateFees };
}
