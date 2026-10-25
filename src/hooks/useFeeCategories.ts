import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useFeeCategories(institutionId: string | undefined) {
  const queryClient = useQueryClient();

  const categoriesQuery = useQuery({
    queryKey: ["fee-categories", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fee_categories")
        .select("*")
        .eq("institution_id", institutionId!)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!institutionId,
  });

  const createCategory = useMutation({
    mutationFn: async (values: { name: string; description?: string; is_recurring: boolean }) => {
      const { data, error } = await supabase
        .from("fee_categories")
        .insert({ ...values, institution_id: institutionId! })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-categories"] });
      toast.success("Fee category created");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateCategory = useMutation({
    mutationFn: async ({ id, ...values }: { id: string; name?: string; description?: string; is_recurring?: boolean; is_active?: boolean }) => {
      const { error } = await supabase.from("fee_categories").update(values).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-categories"] });
      toast.success("Fee category updated");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("fee_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fee-categories"] });
      toast.success("Fee category deleted");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return { categories: categoriesQuery.data ?? [], isLoading: categoriesQuery.isLoading, createCategory, updateCategory, deleteCategory };
}
