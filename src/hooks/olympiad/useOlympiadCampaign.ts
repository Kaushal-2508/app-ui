import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OlympiadCampaign = {
  id: string;
  campaign_year: number;
  default_price_rupees: number;
  gst_percent: number;
  exam_duration_minutes: number;
  questions_per_subject: number;
  pin_expiry_minutes: number;
  gold_threshold_percent: number;
  silver_threshold_percent: number;
  bronze_threshold_percent: number;
  gstin: string | null;
  status: "draft" | "active" | "closed";
  description: string | null;
  created_at: string;
  updated_at: string;
};

export function useOlympiadCampaigns() {
  return useQuery({
    queryKey: ["olympiad", "campaigns"],
    queryFn: async (): Promise<OlympiadCampaign[]> => {
      const { data, error } = await supabase
        .from("oly_campaigns")
        .select(
          "id, campaign_year, default_price_rupees, gst_percent, exam_duration_minutes, questions_per_subject, pin_expiry_minutes, gold_threshold_percent, silver_threshold_percent, bronze_threshold_percent, gstin, status, description, created_at, updated_at",
        )
        .order("campaign_year", { ascending: false });
      if (error) throw error;
      // The generated type has status: string; narrow it here.
      return (data ?? []).map((row) => ({
        ...row,
        status: (row.status as OlympiadCampaign["status"]) ?? "draft",
      }));
    },
    staleTime: 60_000,
  });
}

export type OlympiadCampaignInput = Omit<OlympiadCampaign, "id" | "created_at" | "updated_at"> & {
  id?: string;
};

export function useUpsertOlympiadCampaign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OlympiadCampaignInput): Promise<OlympiadCampaign> => {
      const payload: {
        campaign_year: number;
        default_price_rupees: number;
        gst_percent: number;
        exam_duration_minutes: number;
        questions_per_subject: number;
        pin_expiry_minutes: number;
        gold_threshold_percent: number;
        silver_threshold_percent: number;
        bronze_threshold_percent: number;
        gstin: string | null;
        status: string;
        description: string | null;
      } = {
        campaign_year: input.campaign_year,
        default_price_rupees: input.default_price_rupees,
        gst_percent: input.gst_percent,
        exam_duration_minutes: input.exam_duration_minutes,
        questions_per_subject: input.questions_per_subject,
        pin_expiry_minutes: input.pin_expiry_minutes,
        gold_threshold_percent: input.gold_threshold_percent,
        silver_threshold_percent: input.silver_threshold_percent,
        bronze_threshold_percent: input.bronze_threshold_percent,
        gstin: input.gstin,
        status: input.status,
        description: input.description,
      };
      if (input.id) {
        const { data, error } = await supabase
          .from("oly_campaigns")
          .update(payload)
          .eq("id", input.id)
          .select(
            "id, campaign_year, default_price_rupees, gst_percent, exam_duration_minutes, questions_per_subject, pin_expiry_minutes, gold_threshold_percent, silver_threshold_percent, bronze_threshold_percent, gstin, status, description, created_at, updated_at",
          )
          .single();
        if (error) throw error;
        return { ...data, status: (data.status as OlympiadCampaign["status"]) ?? "draft" };
      }
      const { data, error } = await supabase
        .from("oly_campaigns")
        .insert(payload)
        .select(
          "id, campaign_year, default_price_rupees, gst_percent, exam_duration_minutes, questions_per_subject, pin_expiry_minutes, gold_threshold_percent, silver_threshold_percent, bronze_threshold_percent, gstin, status, description, created_at, updated_at",
        )
        .single();
      if (error) throw error;
      return { ...data, status: (data.status as OlympiadCampaign["status"]) ?? "draft" };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "campaigns"] });
      toast.success("Campaign saved");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save campaign.", context: "useUpsertOlympiadCampaign" }),
  });
}
