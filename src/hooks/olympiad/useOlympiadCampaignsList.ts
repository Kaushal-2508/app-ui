import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OlympiadCampaignListItem = {
  id: string;
  campaign_year: number;
  status: string;
};

export function useOlympiadCampaignsList() {
  return useQuery({
    queryKey: ["olympiad", "campaigns-list"],
    queryFn: async (): Promise<OlympiadCampaignListItem[]> => {
      const { data, error } = await supabase
        .from("oly_campaigns")
        .select("id, campaign_year, status")
        .order("campaign_year", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OlympiadCampaignListItem[];
    },
    staleTime: 5 * 60_000,
  });
}
