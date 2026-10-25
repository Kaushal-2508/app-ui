import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tables } from "@/integrations/supabase/types";

export type EmployeeLevel = Tables<"employee_levels">;

export function useEmployeeLevels() {
  return useQuery({
    queryKey: ["employee-levels"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("employee_levels")
        .select("*")
        .order("level_number");
      if (error) throw error;
      return data as EmployeeLevel[];
    },
  });
}

export function useCreateEmployeeLevel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (level: {
      level_name: string;
      level_number: number;
      description?: string;
      permissions?: Record<string, boolean>;
    }) => {
      const { data, error } = await supabase
        .from("employee_levels")
        .insert({
          level_name: level.level_name,
          level_number: level.level_number,
          description: level.description || null,
          permissions: level.permissions || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-levels"] });
      toast({ title: "Employee level created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create level", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateEmployeeLevel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      level_name?: string;
      level_number?: number;
      description?: string | null;
      permissions?: Record<string, boolean> | null;
    }) => {
      const { error } = await supabase
        .from("employee_levels")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-levels"] });
      toast({ title: "Employee level updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update level", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteEmployeeLevel() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("employee_levels")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["employee-levels"] });
      toast({ title: "Employee level deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete level", description: error.message, variant: "destructive" });
    },
  });
}
