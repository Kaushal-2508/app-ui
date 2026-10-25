import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export interface InstitutionBranding {
  id: string;
  name: string;
  address: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  logoUrl: string | null;
}

/**
 * Resolves an institution's letterhead-grade branding fields.
 *
 * - If `institutionId` is passed, fetches that row.
 * - If omitted, falls back to the current user's `profiles.institution_id`
 *   (the same chain `AppLayout`'s `header-institution` query uses).
 * - Never throws — returns `{ branding: null }` on failure or when no
 *   institution can be resolved (e.g. super-admin without context).
 */
export function useInstitutionBranding(institutionId?: string | null): {
  branding: InstitutionBranding | null;
  isLoading: boolean;
} {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ["institution-branding", institutionId ?? "current", user?.id],
    queryFn: async (): Promise<InstitutionBranding | null> => {
      let resolvedId = institutionId ?? null;

      if (!resolvedId) {
        if (!user?.id) return null;
        const { data: profile } = await supabase
          .from("profiles")
          .select("institution_id")
          .eq("id", user.id)
          .maybeSingle();
        resolvedId = profile?.institution_id ?? null;
      }

      if (!resolvedId) return null;

      const { data, error } = await supabase
        .from("institutions")
        .select("id, name, address, contact_email, contact_phone, logo_url")
        .eq("id", resolvedId)
        .maybeSingle();
      if (error || !data) return null;

      return {
        id: data.id,
        name: data.name,
        address: data.address,
        contactEmail: data.contact_email,
        contactPhone: data.contact_phone,
        logoUrl: data.logo_url,
      };
    },
    enabled: !!(institutionId || user?.id),
    staleTime: 5 * 60 * 1000,
  });

  return {
    branding: query.data ?? null,
    isLoading: query.isLoading,
  };
}
