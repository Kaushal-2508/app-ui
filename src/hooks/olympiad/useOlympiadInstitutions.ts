import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type InstitutionPickerRow = { id: string; name: string; code: string };

export function useOlympiadInstitutions() {
  return useQuery({
    queryKey: ["olympiad", "institutions-pickable"],
    queryFn: async (): Promise<InstitutionPickerRow[]> => {
      const { data, error } = await supabase
        .from("institutions")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data ?? []) as InstitutionPickerRow[];
    },
    staleTime: 5 * 60_000,
  });
}
