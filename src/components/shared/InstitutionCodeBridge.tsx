import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { setCurrentInstitutionCode } from "@/lib/sectionDisplay";

/**
 * Keeps the module-level institution code in `src/lib/sectionDisplay` in sync
 * with the effective institution. Used to scope display-only tweaks (e.g. AISB
 * LKG/UKG section color labels) without refactoring every call site.
 *
 * Renders nothing.
 */
export function InstitutionCodeBridge() {
  const { institutionId } = useEffectiveInstitution();
  const { managedInstitution, isManagingInstitution } = useInstitutionContext();

  // When super-admin is managing an institution, we already have its code cached.
  const codeFromContext = isManagingInstitution ? managedInstitution?.code ?? null : null;

  // Otherwise fetch the code for the current user's own institution.
  const { data: ownInstitutionCode } = useQuery({
    queryKey: ["institution-code", institutionId],
    queryFn: async (): Promise<string | null> => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("institutions")
        .select("code")
        .eq("id", institutionId)
        .maybeSingle();
      if (error) return null;
      return data?.code ?? null;
    },
    enabled: !!institutionId && !codeFromContext,
    staleTime: 10 * 60 * 1000,
  });

  const effectiveCode = codeFromContext ?? ownInstitutionCode ?? null;

  useEffect(() => {
    setCurrentInstitutionCode(effectiveCode);
  }, [effectiveCode]);

  return null;
}
