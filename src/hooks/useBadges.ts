import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'diamond';
export type BadgeType = 'student' | 'teacher' | 'coordinator' | 'universal';

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string | null;
  icon_name: string;
  badge_type: string;
  category: string;
  tier: BadgeTier;
  criteria_type: string;
  criteria_value: number;
  criteria_metric: string;
  points: number;
  is_active: boolean;
  display_order: number;
}

export interface UserBadge {
  id: string;
  user_id: string;
  badge_id: string;
  institution_id: string | null;
  earned_at: string;
  source_entity_id: string | null;
  source_entity_type: string | null;
  metadata: Record<string, unknown>;
  is_featured: boolean;
  badge?: BadgeDefinition;
}

export interface BadgeProgress {
  id: string;
  user_id: string;
  badge_id: string;
  institution_id: string | null;
  current_value: number;
  target_value: number;
  last_updated: string;
  badge?: BadgeDefinition;
}

// Fetch all badge definitions
export function useBadgeDefinitions(badgeType?: string) {
  return useQuery({
    queryKey: ["badge-definitions", badgeType],
    // Badge catalog changes ~never; definitions are static seed data (§23).
    staleTime: 30 * 60_000,
    queryFn: async () => {
      let query = supabase
        .from("badge_definitions")
        .select("*")
        .eq("is_active", true)
        .order("display_order");

      if (badgeType) {
        query = query.eq("badge_type", badgeType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as BadgeDefinition[];
    },
  });
}

// Fetch user's earned badges
export function useUserBadges(userId?: string) {
  return useQuery({
    queryKey: ["user-badges", userId],
    // Invalidated explicitly on award (useAwardBadge.onSuccess) — no need
    // to refetch on every mount (§23).
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const targetUserId = userId || user?.id;
      if (!targetUserId) return [];

      const { data, error } = await supabase
        .from("user_badges")
        .select(`
          *,
          badge:badge_definitions(*)
        `)
        .eq("user_id", targetUserId)
        .order("earned_at", { ascending: false });

      if (error) throw error;
      return data as (UserBadge & { badge: BadgeDefinition })[];
    },
    enabled: true,
  });
}

// Fetch user's badge progress
export function useBadgeProgress(userId?: string) {
  return useQuery({
    queryKey: ["badge-progress", userId],
    staleTime: 5 * 60_000, // §23: explicit staleTime on every query
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const targetUserId = userId || user?.id;
      if (!targetUserId) return [];

      const { data, error } = await supabase
        .from("badge_progress")
        .select(`
          *,
          badge:badge_definitions(*)
        `)
        .eq("user_id", targetUserId);

      if (error) throw error;
      return data as (BadgeProgress & { badge: BadgeDefinition })[];
    },
  });
}

// Get badge statistics for a user
export function useBadgeStats() {
  return useQuery({
    queryKey: ["badge-stats"],
    // Invalidated explicitly on award (useAwardBadge.onSuccess) (§23).
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data: badges, error } = await supabase
        .from("user_badges")
        .select(`
          id,
          badge:badge_definitions(points, tier)
        `)
        .eq("user_id", user.id);

      if (error) throw error;

      // PostgREST to-one embed — narrow inline instead of `any` (§5a)
      type BadgeJoin = { points: number | null; tier: BadgeTier | null } | null;
      const totalPoints = badges?.reduce((sum, b) => sum + ((b.badge as BadgeJoin)?.points || 0), 0) || 0;
      const tierCounts = {
        bronze: 0,
        silver: 0,
        gold: 0,
        platinum: 0,
        diamond: 0,
      };

      badges?.forEach(b => {
        const tier = (b.badge as BadgeJoin)?.tier;
        if (tier && tier in tierCounts) {
          tierCounts[tier]++;
        }
      });

      return {
        totalBadges: badges?.length || 0,
        totalPoints,
        tierCounts,
      };
    },
  });
}

// Log activity (for portal usage tracking)
export function useLogActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      activityType,
      metadata = {},
    }: {
      activityType: string;
      // Json (not `any`/`unknown`) — this value is written to a jsonb column,
      // so it must satisfy Supabase's generated Json type (§5a).
      metadata?: Record<string, Json>;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get user's institution
      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .single();

      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from("user_activity_log")
        .upsert(
          {
            user_id: user.id,
            institution_id: profile?.institution_id,
            activity_type: activityType,
            activity_date: today,
            count: 1,
            metadata,
          },
          {
            onConflict: "user_id,activity_type,activity_date",
          }
        )
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["badge-progress"] });
      queryClient.invalidateQueries({ queryKey: ["user-badges"] });
    },
  });
}

// Award a badge to a user
export function useAwardBadge() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      badgeId,
      institutionId,
      sourceEntityId,
      sourceEntityType,
      metadata = {},
    }: {
      userId: string;
      badgeId: string;
      institutionId?: string;
      sourceEntityId?: string;
      sourceEntityType?: string;
      // Written to a jsonb column — must satisfy the generated Json type.
      metadata?: Record<string, Json>;
    }) => {
      const { data, error } = await supabase
        .from("user_badges")
        .insert({
          user_id: userId,
          badge_id: badgeId,
          institution_id: institutionId,
          source_entity_id: sourceEntityId,
          source_entity_type: sourceEntityType,
          metadata,
        })
        .select()
        .single();

      if (error) {
        // Ignore duplicate badge errors
        if (error.code === '23505') return null;
        throw error;
      }
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-badges"] });
      queryClient.invalidateQueries({ queryKey: ["badge-stats"] });
    },
  });
}

// Get tier color classes
export function getTierStyles(tier: BadgeTier) {
  const styles = {
    bronze: {
      bg: "bg-amber-100 dark:bg-amber-900/30",
      border: "border-amber-300 dark:border-amber-700",
      text: "text-amber-700 dark:text-amber-300",
      glow: "shadow-amber-200/50 dark:shadow-amber-800/30",
      gradient: "from-amber-400 to-amber-600",
    },
    silver: {
      bg: "bg-slate-100 dark:bg-slate-800/50",
      border: "border-slate-300 dark:border-slate-600",
      text: "text-slate-700 dark:text-slate-300",
      glow: "shadow-slate-200/50 dark:shadow-slate-700/30",
      gradient: "from-slate-300 to-slate-500",
    },
    gold: {
      bg: "bg-yellow-100 dark:bg-yellow-900/30",
      border: "border-yellow-400 dark:border-yellow-600",
      text: "text-yellow-700 dark:text-yellow-300",
      glow: "shadow-yellow-200/50 dark:shadow-yellow-800/30",
      gradient: "from-yellow-400 to-yellow-600",
    },
    platinum: {
      bg: "bg-cyan-100 dark:bg-cyan-900/30",
      border: "border-cyan-300 dark:border-cyan-600",
      text: "text-cyan-700 dark:text-cyan-300",
      glow: "shadow-cyan-200/50 dark:shadow-cyan-800/30",
      gradient: "from-cyan-400 to-cyan-600",
    },
    diamond: {
      bg: "bg-purple-100 dark:bg-purple-900/30",
      border: "border-purple-400 dark:border-purple-600",
      text: "text-purple-700 dark:text-purple-300",
      glow: "shadow-purple-200/50 dark:shadow-purple-800/30",
      gradient: "from-purple-400 via-pink-500 to-purple-600",
    },
  };
  return styles[tier] || styles.bronze;
}
