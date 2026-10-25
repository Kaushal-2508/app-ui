import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { getDisplayName } from "@/lib/displayName";

export interface UserAIUsage {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  role: string;
  questions_used_today: number;
  daily_limit: number;
  last_reset_date: string | null;
  limit_id: string | null;
}

export interface InstitutionAIStats {
  total_users: number;
  users_with_limits: number;
  total_questions_today: number;
  total_daily_limit: number;
  institution_quota: {
    daily_question_limit: number;
    question_generation_enabled: boolean;
  } | null;
}

export function useInstitutionUsersWithAI(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-users-ai", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      // Step 1: Get all profiles in this institution
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("institution_id", institutionId);

      if (profilesError) throw profilesError;
      if (!profiles || profiles.length === 0) return [];

      // Step 2: Get roles for these users (separate query to avoid RLS issues)
      const userIds = profiles.map(p => p.id);
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds)
        .in("role", ["teacher", "coordinator", "school_admin"]);

      if (rolesError) throw rolesError;

      // Create a map of user_id -> role
      const rolesMap = new Map<string, string>();
      (roles || []).forEach((r: { user_id: string; role: string }) => {
        rolesMap.set(r.user_id, r.role);
      });

      // Filter profiles to only those with valid roles
      const validProfiles = profiles.filter(p => rolesMap.has(p.id));

      // Step 3: Get AI limits for this institution
      const { data: limits, error: limitsError } = await supabase
        .from("user_question_limits")
        .select("*")
        .eq("institution_id", institutionId);

      if (limitsError) throw limitsError;

      const today = new Date().toISOString().split("T")[0];
      const limitsMap = new Map(limits?.map(l => [l.user_id, l]) || []);

      const result: UserAIUsage[] = validProfiles.map((user) => {
        const limit = limitsMap.get(user.id);
        const isToday = limit?.last_reset_date === today;
        
        return {
          id: user.id,
          user_id: user.id,
          full_name: getDisplayName(user),
          email: user.email || "",
          role: rolesMap.get(user.id) || "unknown",
          questions_used_today: isToday ? (limit?.questions_used_today || 0) : 0,
          daily_limit: limit?.daily_limit || 0,
          last_reset_date: limit?.last_reset_date || null,
          limit_id: limit?.id || null,
        };
      });

      return result;
    },
    enabled: !!institutionId,
  });
}

export function useInstitutionAIStats(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-ai-stats", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;

      // Get user count
      const { count: userCount } = await supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("institution_id", institutionId);

      // Get limits
      const { data: limits } = await supabase
        .from("user_question_limits")
        .select("*")
        .eq("institution_id", institutionId);

      // Get institution quota
      const { data: quota } = await supabase
        .from("ai_usage_quotas")
        .select("daily_question_limit, question_generation_enabled")
        .eq("institution_id", institutionId)
        .maybeSingle();

      const today = new Date().toISOString().split("T")[0];
      const todayLimits = limits?.filter(l => l.last_reset_date === today) || [];

      const stats: InstitutionAIStats = {
        total_users: userCount || 0,
        users_with_limits: limits?.length || 0,
        total_questions_today: todayLimits.reduce((sum, l) => sum + (l.questions_used_today || 0), 0),
        total_daily_limit: limits?.reduce((sum, l) => sum + (l.daily_limit || 0), 0) || 0,
        institution_quota: quota,
      };

      return stats;
    },
    enabled: !!institutionId,
  });
}

export function useUpdateUserAILimit() {
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
        const { error } = await supabase
          .from("user_question_limits")
          .update({ daily_limit: dailyLimit })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
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
      queryClient.invalidateQueries({ queryKey: ["institution-users-ai"] });
      queryClient.invalidateQueries({ queryKey: ["institution-ai-stats"] });
      toast({ title: "User limit updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update limit", description: error.message, variant: "destructive" });
    },
  });
}

export function useResetUserUsage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (userId: string) => {
      const today = new Date().toISOString().split("T")[0];
      
      const { error } = await supabase
        .from("user_question_limits")
        .update({ 
          questions_used_today: 0,
          last_reset_date: today 
        })
        .eq("user_id", userId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-users-ai"] });
      queryClient.invalidateQueries({ queryKey: ["institution-ai-stats"] });
      toast({ title: "Usage reset successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to reset usage", description: error.message, variant: "destructive" });
    },
  });
}

export function useBulkSetLimits() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({
      userIds,
      institutionId,
      dailyLimit,
    }: {
      userIds: string[];
      institutionId: string;
      dailyLimit: number;
    }) => {
      const today = new Date().toISOString().split("T")[0];

      for (const userId of userIds) {
        const { data: existing } = await supabase
          .from("user_question_limits")
          .select("id")
          .eq("user_id", userId)
          .maybeSingle();

        if (existing) {
          await supabase
            .from("user_question_limits")
            .update({ daily_limit: dailyLimit })
            .eq("id", existing.id);
        } else {
          await supabase
            .from("user_question_limits")
            .insert({
              user_id: userId,
              institution_id: institutionId,
              daily_limit: dailyLimit,
              questions_used_today: 0,
              last_reset_date: today,
            });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-users-ai"] });
      queryClient.invalidateQueries({ queryKey: ["institution-ai-stats"] });
      toast({ title: "Bulk limits updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update limits", description: error.message, variant: "destructive" });
    },
  });
}
