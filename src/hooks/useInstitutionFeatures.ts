import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "./useEffectiveInstitution";

export function useInstitutionFeatures() {
  const { institutionId, isLoading: instLoading } = useEffectiveInstitution();

  const query = useQuery({
    queryKey: ["institution-features", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("institution_features")
        .select("feature_id")
        .eq("institution_id", institutionId);
      if (error) throw error;
      return (data || []).map((r) => r.feature_id);
    },
    enabled: !!institutionId,
  });

  const enabledFeatures = query.data ?? [];

  return {
    enabledFeatures,
    isLoading: instLoading || query.isLoading,
    isFeatureEnabled: (featureId: string) => enabledFeatures.includes(featureId),
  };
}
