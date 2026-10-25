import { useQueries, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import type {
  NoticeClassStaff,
  NoticeScope,
  NoticeTargetOption,
  RecipientRole,
} from "./types";

/**
 * The classes and wings THIS author is allowed to address.
 *
 * The list is already scoped server-side (admin: whole school, coordinator:
 * their wings, teacher: classes they teach, and teachers are offered no wings
 * at all), so the composer can render it directly. publish_notice re-checks
 * everything anyway -- this exists so the UI never offers a choice the RPC
 * would refuse.
 */
export function useNoticeTargetOptions(enabled = true) {
  return useQuery({
    queryKey: ["notices", "target-options"],
    queryFn: async (): Promise<{
      classes: NoticeTargetOption[];
      wings: NoticeTargetOption[];
    }> => {
      const { data, error } = await supabase.rpc("notice_target_options");
      if (error) throw error;
      const rows = data ?? [];
      return {
        classes: rows.filter((r) => r.kind === "class"),
        wings: rows.filter((r) => r.kind === "wing"),
      };
    },
    enabled,
    staleTime: 5 * 60_000, // rosters change rarely; this is picker furniture
    refetchOnWindowFocus: false,
  });
}

/**
 * Teachers of the chosen classes (pickable) and the wing coordinators those
 * classes pull in (locked, shown so the author can see who is being kept in the
 * loop before they publish).
 */
export function useNoticeClassStaff(classIds: string[]) {
  const key = [...classIds].sort().join(",");
  return useQuery({
    queryKey: ["notices", "class-staff", key],
    queryFn: async (): Promise<{
      teachers: NoticeClassStaff[];
      coordinators: NoticeClassStaff[];
    }> => {
      if (classIds.length === 0) return { teachers: [], coordinators: [] };
      const { data, error } = await supabase.rpc("notice_class_staff", {
        _class_ids: classIds,
      });
      if (error) throw error;
      const rows = data ?? [];
      return {
        teachers: rows.filter((r) => r.kind === "teacher"),
        coordinators: rows.filter((r) => r.kind === "coordinator"),
      };
    },
    enabled: classIds.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface AudiencePreviewArgs {
  scope: NoticeScope;
  classIds?: string[];
  wingIds?: string[];
  audienceRoles?: RecipientRole[];
  teacherIds?: string[];
}

/**
 * Live "Reaches 84 students, 12 teachers, 1 coordinator" for the composer.
 *
 * Runs the SAME expansion expression publish_notice uses, so the promised reach
 * cannot disagree with the delivered one. Callers pass an already-debounced
 * argument object; `enabled` gates it so an incomplete selection never fires.
 */
export function useNoticeAudiencePreview(
  args: AudiencePreviewArgs,
  enabled: boolean,
) {
  const key = JSON.stringify({
    s: args.scope,
    c: [...(args.classIds ?? [])].sort(),
    w: [...(args.wingIds ?? [])].sort(),
    r: [...(args.audienceRoles ?? [])].sort(),
    t: [...(args.teacherIds ?? [])].sort(),
  });

  return useQuery({
    queryKey: ["notices", "audience-preview", key],
    queryFn: async (): Promise<Record<string, number>> => {
      const { data, error } = await supabase.rpc("notice_audience_preview", {
        _scope: args.scope,
        _class_ids: args.classIds?.length ? args.classIds : undefined,
        _wing_ids: args.wingIds?.length ? args.wingIds : undefined,
        _audience_roles: args.audienceRoles?.length
          ? args.audienceRoles
          : undefined,
        _teacher_ids: args.teacherIds?.length ? args.teacherIds : undefined,
      });
      if (error) throw error;
      const out: Record<string, number> = {};
      for (const row of data ?? []) out[row.recipient_role] = row.total;
      return out;
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The teachers of EACH chosen class, one bounded RPC per class under the same
 * cache keys as `useNoticeClassStaff([classId])`, so a class box and the
 * composer share rows. The admin's online PTM needs attribution per class
 * (`notice_class_staff` over several classes de-duplicates teachers and loses
 * it). A class whose list is still loading is `undefined`, never `[]`, so the
 * caller does not say "nobody is assigned" too early. A single RPC returning
 * (class_id, teacher) pairs would collapse the fan-out: nice to have, NEEDS DB.
 */
export function useNoticeClassStaffPerClass(classIds: string[]) {
  const results = useQueries({
    queries: classIds.map((classId) => ({
      queryKey: ["notices", "class-staff", classId],
      queryFn: async (): Promise<{ teachers: NoticeClassStaff[]; coordinators: NoticeClassStaff[] }> => {
        const { data, error } = await supabase.rpc("notice_class_staff", { _class_ids: [classId] });
        if (error) throw error;
        const rows = data ?? [];
        return {
          teachers: rows.filter((r) => r.kind === "teacher"),
          coordinators: rows.filter((r) => r.kind === "coordinator"),
        };
      },
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    })),
  });
  const teachersOf: Record<string, NoticeClassStaff[] | undefined> = {};
  const loading: Record<string, boolean> = {};
  const errored: Record<string, boolean> = {};
  const refetchers: Record<string, () => void> = {};
  classIds.forEach((id, i) => {
    const r = results[i];
    teachersOf[id] = r?.data?.teachers;
    loading[id] = !!r?.isLoading;
    errored[id] = !!r?.isError;
    refetchers[id] = () => void r?.refetch();
  });
  return {
    teachersOf,
    loading,
    errored,
    anyLoading: results.some((r) => r.isLoading),
    refetch: (classId: string) => refetchers[classId]?.(),
  };
}
