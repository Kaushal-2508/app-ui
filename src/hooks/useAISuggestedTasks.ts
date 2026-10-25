import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface AISuggestedTask {
  id: string;
  institution_id: string;
  suggested_for: string;
  suggested_assignee: string | null;
  wing_id: string | null;
  title: string;
  description: string | null;
  task_type: string;
  priority: number;
  source_type: string;
  source_data: Record<string, unknown> | null;
  status: string;
  created_at: string;
  actioned_at: string | null;
}

/**
 * Fetches AI-suggested tasks for the current user (typically a principal).
 */
export function useAISuggestedTasks() {
  return useQuery({
    queryKey: ["ai-suggested-tasks"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("ai_suggested_tasks")
        .select("*")
        .eq("suggested_for", user.id)
        .eq("status", "pending")
        .order("priority", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as AISuggestedTask[];
    },
  });
}

/**
 * Generates new AI task suggestions for the principal.
 */
export function useGenerateTaskSuggestions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ institutionId }: { institutionId: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("generate-principal-tasks", {
        body: {
          institution_id: institutionId,
          principal_id: user.id,
        },
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["ai-suggested-tasks"] });
      toast({
        title: "Suggestions generated",
        description: `${data.count} new task suggestions are ready for review.`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error generating suggestions",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}

/**
 * Dismiss or accept an AI suggestion.
 */
export function useUpdateSuggestionStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ 
      suggestionId, 
      status 
    }: { 
      suggestionId: string; 
      status: "accepted" | "dismissed" 
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("ai_suggested_tasks")
        .update({
          status,
          actioned_at: new Date().toISOString(),
          actioned_by: user.id,
        })
        .eq("id", suggestionId);

      if (error) throw error;
    },
    onSuccess: (_, { status }) => {
      queryClient.invalidateQueries({ queryKey: ["ai-suggested-tasks"] });
      if (status === "dismissed") {
        toast({
          title: "Suggestion dismissed",
          description: "The suggestion has been removed.",
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error updating suggestion",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
