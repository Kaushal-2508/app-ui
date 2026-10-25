import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface UserQuestionLimit {
  id: string;
  user_id: string;
  institution_id: string | null;
  daily_limit: number;
  questions_used_today: number;
  last_reset_date: string;
  created_at: string;
  updated_at: string;
  user?: { full_name: string; email: string } | null;
}

export function useUserQuestionLimits(institutionId: string | null) {
  return useQuery({
    queryKey: ["user-question-limits", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      const { data, error } = await supabase
        .from("user_question_limits")
        .select(`
          *,
          user:profiles!user_id(full_name, email)
        `)
        .eq("institution_id", institutionId)
        .order("updated_at", { ascending: false });

      if (error) throw error;
      return data as UserQuestionLimit[];
    },
    enabled: !!institutionId,
  });
}

export function useMyQuestionLimit() {
  return useQuery({
    queryKey: ["my-question-limit"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase
        .from("user_question_limits")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) throw error;

      // Check if we need to reset daily count
      if (data) {
        const today = new Date().toISOString().split("T")[0];
        if (data.last_reset_date !== today) {
          // Reset the count for today
          const { data: updated, error: updateError } = await supabase
            .from("user_question_limits")
            .update({
              questions_used_today: 0,
              last_reset_date: today,
            })
            .eq("id", data.id)
            .select()
            .single();

          if (!updateError && updated) {
            return updated;
          }
        }
      }

      return data;
    },
  });
}

export function useSetUserQuestionLimit() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      userId,
      institutionId,
      dailyLimit,
    }: {
      userId: string;
      institutionId: string;
      dailyLimit: number;
    }) => {
      // Check if limit exists
      const { data: existing } = await supabase
        .from("user_question_limits")
        .select("id")
        .eq("user_id", userId)
        .maybeSingle();

      if (existing) {
        // Update existing
        const { error } = await supabase
          .from("user_question_limits")
          .update({ daily_limit: dailyLimit })
          .eq("id", existing.id);

        if (error) throw error;
      } else {
        // Insert new
        const today = new Date().toISOString().split("T")[0];
        const { error } = await supabase
          .from("user_question_limits")
          .insert({
            user_id: userId,
            institution_id: institutionId,
            daily_limit: dailyLimit,
            questions_used_today: 0,
            last_reset_date: today,
          });

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-question-limits"] });
      toast({ title: "User limit updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update limit", description: error.message, variant: "destructive" });
    },
  });
}

export function useIncrementQuestionUsage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (count: number = 1) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get current limit
      const { data: limit } = await supabase
        .from("user_question_limits")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();

      const today = new Date().toISOString().split("T")[0];

      if (limit) {
        const currentUsed = limit.last_reset_date === today 
          ? limit.questions_used_today 
          : 0;

        const { error } = await supabase
          .from("user_question_limits")
          .update({
            questions_used_today: currentUsed + count,
            last_reset_date: today,
          })
          .eq("id", limit.id);

        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-question-limit"] });
    },
  });
}