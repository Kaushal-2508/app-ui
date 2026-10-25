import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reads institutions.logo_url for the given id.
 * Returns { logoUrl: null } when the column is null OR the row is unreadable.
 * Never throws — consumers fall back silently to text-only branding.
 */
export function useInstitutionLogo(institutionId: string | null | undefined): {
  logoUrl: string | null;
  isLoading: boolean;
} {
  const query = useQuery({
    queryKey: ["institution-logo", institutionId],
    queryFn: async (): Promise<string | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("institutions")
        .select("logo_url")
        .eq("id", institutionId)
        .maybeSingle();
      if (error) return null;
      return data?.logo_url ?? null;
    },
    enabled: !!institutionId,
    staleTime: 5 * 60 * 1000, // 5 min — logos change rarely
  });

  return {
    logoUrl: query.data ?? null,
    isLoading: query.isLoading,
  };
}
