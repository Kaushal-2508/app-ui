import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type ExamMode = Database["public"]["Enums"]["exam_mode"];

export interface ExamDelivery {
  /** `is_offline` is the legacy flag; it is folded in so callers test one field. */
  mode: ExamMode;
  /** Results-only ("Already Created") exams use the section-marks pipeline. */
  isResultsOnly: boolean;
}

export type ExamDeliveryMap = Record<string, ExamDelivery>;

/**
 * A hard ceiling on the id list. Callers pass the handful of exams currently on
 * screen (the trend chart plots at most 24 — dash_*_exam_trend clamps p_limit),
 * so this is generous; it exists so a future caller cannot turn this into an
 * unbounded fetch.
 */
const MAX_IDS = 50;

function normalizeIds(examIds: string[]): string[] {
  // Sorted and de-duplicated so the query key is stable regardless of the order
  // rows arrive in — otherwise a re-sorted chart refetches identical data.
  return Array.from(new Set(examIds)).sort().slice(0, MAX_IDS);
}

function deliveryQuery(ids: string[]) {
  return {
    queryKey: ["exam-delivery-modes", ids] as const,
    // Delivery mode is decided when the exam is authored and never changes
    // afterwards, so this can sit well past the 60s dashboard default.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ExamDeliveryMap> => {
      const { data, error } = await supabase
        .from("exams")
        .select("id, exam_mode, is_offline, is_results_only")
        .in("id", ids)
        .limit(MAX_IDS);
      if (error) throw error;
      const map: ExamDeliveryMap = {};
      for (const row of data ?? []) {
        map[row.id] = {
          mode: row.is_offline ? "offline" : row.exam_mode,
          isResultsOnly: !!row.is_results_only,
        };
      }
      return map;
    },
  };
}

/**
 * How a set of exams was delivered — online, offline or hybrid — so a surface
 * can send the user to the right place for each one. Read directly from `exams`
 * rather than added to the dashboard RPC payloads so the fix ships with the
 * frontend alone; RLS ("Users can view exams in their institution") covers
 * every role that can see an exam listed.
 */
export function useExamDeliveryModes(examIds: string[]) {
  const ids = useMemo(() => normalizeIds(examIds), [examIds]);
  const queryClient = useQueryClient();

  const query = useQuery({
    ...deliveryQuery(ids),
    enabled: ids.length > 0,
  });

  /**
   * Resolve the map on demand — for a click that lands before the prefetch has
   * settled, or after it failed. Returns the cached value when it is fresh, so
   * the common path costs nothing; throws so the caller can `toastError` rather
   * than routing the user somewhere wrong on a silent failure.
   */
  const ensure = useCallback(
    () => queryClient.fetchQuery(deliveryQuery(ids)),
    [queryClient, ids],
  );

  return { map: query.data, isLoading: query.isLoading, ensure };
}
