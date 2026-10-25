import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TopInstitutionSymbol {
  symbol: string;
  usageCount: number;
  lastUsedAt: string;
}

const TOP_SYMBOLS_KEY = ["institution-symbol-usage", "top"] as const;

/**
 * Read the most-used symbols across the caller's institution. Powers the
 * "Frequently used" page in the symbol picker. Returns an empty array on
 * cold start (no rows yet) or for users with no resolvable institution.
 */
export function useTopInstitutionSymbols(limit = 8) {
  return useQuery({
    queryKey: [...TOP_SYMBOLS_KEY, limit],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<TopInstitutionSymbol[]> => {
      const { data, error } = await supabase.rpc("get_top_institution_symbols", {
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []).map((row) => ({
        symbol: row.symbol,
        usageCount: Number(row.usage_count),
        lastUsedAt: row.last_used_at,
      }));
    },
  });
}

/**
 * Increment the institution-wide counter for a single symbol. Teacher-only
 * at the DB layer (the RPC no-ops for everyone else), so call sites can fire
 * for any role without branching. Failures are intentionally swallowed —
 * telemetry must never break the user's insertion flow.
 */
export function useRecordSymbolUsage() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (symbol: string) => {
      const { error } = await supabase.rpc("record_symbol_usage", {
        p_symbol: symbol,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TOP_SYMBOLS_KEY });
    },
  });

  const record = useCallback(
    (symbol: string) => {
      mutation.mutate(symbol, {
        onError: () => {
          /* swallow — telemetry must not break insertion */
        },
      });
    },
    [mutation]
  );

  return record;
}
