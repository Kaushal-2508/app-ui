import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Tables } from "@/integrations/supabase/types";

export type Wing = Tables<"wings">;

export interface WingWithAssignments extends Wing {
  assigned_users: number;
  /** Classes mapped to the wing (wing_class_mappings), for the wing cards. */
  assigned_classes: number;
  class_ids: string[];
}

export function useWings(institutionId: string | null) {
  return useQuery({
    queryKey: ["wings", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      
      const { data: wings, error } = await supabase
        .from("wings")
        .select("*")
        .eq("institution_id", institutionId)
        .order("display_order");
      
      if (error) throw error;

      // Get assignment counts - only for wings in this institution
      const wingIds = wings.map(w => w.id);
      
      if (wingIds.length === 0) {
        return wings.map(w => ({
          ...w,
          assigned_users: 0,
          assigned_classes: 0,
          class_ids: [],
        })) as WingWithAssignments[];
      }

      // Members and classes per wing, one bounded read each (a school has a
      // few wings, tens of staff per wing and under a hundred classes).
      const [{ data: assignments, error: assignmentsError }, { data: mappings, error: mappingsError }] = await Promise.all([
        supabase.from("wing_assignments").select("wing_id").in("wing_id", wingIds).range(0, 1999),
        supabase.from("wing_class_mappings").select("wing_id, class_id").in("wing_id", wingIds).range(0, 1999),
      ]);
      if (assignmentsError) throw assignmentsError;
      if (mappingsError) throw mappingsError;

      const countMap = new Map<string, number>();
      assignments?.forEach(a => {
        countMap.set(a.wing_id, (countMap.get(a.wing_id) || 0) + 1);
      });
      const classMap = new Map<string, string[]>();
      mappings?.forEach(m => {
        classMap.set(m.wing_id, [...(classMap.get(m.wing_id) || []), m.class_id]);
      });

      return wings.map(w => ({
        ...w,
        assigned_users: countMap.get(w.id) || 0,
        assigned_classes: classMap.get(w.id)?.length || 0,
        class_ids: classMap.get(w.id) || [],
      })) as WingWithAssignments[];
    },
    enabled: !!institutionId,
  });
}

export function useCreateWing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (wing: {
      institution_id: string;
      name: string;
      description?: string;
      display_order?: number;
    }) => {
      const { data, error } = await supabase
        .from("wings")
        .insert({
          institution_id: wing.institution_id,
          name: wing.name,
          description: wing.description || null,
          display_order: wing.display_order || 0,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      toast({ title: "Wing created successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create wing", description: error.message, variant: "destructive" });
    },
  });
}

export function useUpdateWing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      description?: string | null;
      display_order?: number;
      is_active?: boolean;
    }) => {
      const { error } = await supabase
        .from("wings")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      toast({ title: "Wing updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update wing", description: error.message, variant: "destructive" });
    },
  });
}

export function useDeleteWing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (id: string) => {
      // First remove all assignments
      await supabase.from("wing_assignments").delete().eq("wing_id", id);

      const { error } = await supabase
        .from("wings")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      toast({ title: "Wing deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete wing", description: error.message, variant: "destructive" });
    },
  });
}

export function useWingAssignments(wingId: string | null) {
  return useQuery({
    queryKey: ["wing-assignments", wingId],
    queryFn: async () => {
      if (!wingId) return [];
      
      const { data, error } = await supabase
        .from("wing_assignments")
        .select(`
          id,
          user_id,
          assigned_at,
          profiles:user_id(id, full_name, email)
        `)
        .eq("wing_id", wingId);
      
      if (error) throw error;
      return data;
    },
    enabled: !!wingId,
  });
}

export function useAssignUserToWing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ wingId, userId }: { wingId: string; userId: string }) => {
      const { data: user } = await supabase.auth.getUser();
      
      const { error } = await supabase
        .from("wing_assignments")
        .insert({
          wing_id: wingId,
          user_id: userId,
          assigned_by: user.user?.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      queryClient.invalidateQueries({ queryKey: ["wing-assignments"] });
      toast({ title: "User assigned to wing" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to assign user", description: error.message, variant: "destructive" });
    },
  });
}

export function useReorderWings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (updates: { id: string; display_order: number }[]) => {
      for (const { id, display_order } of updates) {
        const { error } = await supabase
          .from("wings")
          .update({ display_order })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wings"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reorder wings", description: error.message, variant: "destructive" });
    },
  });
}

export function useRemoveUserFromWing() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ wingId, userId }: { wingId: string; userId: string }) => {
      const { error } = await supabase
        .from("wing_assignments")
        .delete()
        .eq("wing_id", wingId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      queryClient.invalidateQueries({ queryKey: ["wing-assignments"] });
      toast({ title: "User removed from wing" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove user", description: error.message, variant: "destructive" });
    },
  });
}
