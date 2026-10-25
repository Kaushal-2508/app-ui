import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { TablesUpdate } from "@/integrations/supabase/types";
import { toast } from "sonner";

export function useFeeStructures(institutionId: string | undefined) {
  const queryClient = useQueryClient();

  const structuresQuery = useQuery({
    queryKey: ["fee-structures", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_structures")
        .select("*, fee_categories(name), classes(name, section)")
        .eq("institution_id", institutionId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const createStructure = useMutation({
    mutationFn: async (values: {
      fee_category_id: string;
      class_id?: string | null;
      academic_year: string;
      amount: number;
      frequency: string;
      due_day?: number | null;
      late_fee_amount?: number;
      late_fee_type?: string;
      grace_period_days?: number;
    }) => {
      const { data, error } = await supabase
        .from("fee_structures")
        .insert({ ...values, institution_id: institutionId! })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-structures"] });
      toast.success("Fee structure created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateStructure = useMutation({
    mutationFn: async ({ id, ...values }: { id: string } & TablesUpdate<"fee_structures">) => {
      const { error } = await supabase.from("fee_structures").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-structures"] });
      toast.success("Fee structure updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteStructure = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fee_structures").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-structures"] });
      toast.success("Fee structure deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { structures: structuresQuery.data ?? [], isLoading: structuresQuery.isLoading, createStructure, updateStructure, deleteStructure };
}
