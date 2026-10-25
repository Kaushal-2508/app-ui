import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface CommunicationSettings {
  id: string;
  institution_id: string;
  email_enabled: boolean;
  email_provider: string | null;
  email_api_key: string | null;
  email_from_address: string | null;
  sms_enabled: boolean;
  sms_provider: string | null;
  sms_api_key: string | null;
  sms_sender_id: string | null;
  whatsapp_enabled: boolean;
  whatsapp_provider: string | null;
  whatsapp_api_key: string | null;
  whatsapp_phone_number: string | null;
  bulk_messaging_enabled: boolean;
}

export function useCommunicationSettings(institutionId: string | null) {
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ["communication-settings", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;
      const { data, error } = await supabase
        .from("institution_communication_settings")
        .select("*")
        .eq("institution_id", institutionId)
        .maybeSingle();
      if (error) throw error;
      return data as CommunicationSettings | null;
    },
    enabled: !!institutionId,
  });

  const upsertSettings = useMutation({
    mutationFn: async (settings: Partial<CommunicationSettings> & { institution_id: string }) => {
      const { data: existing } = await supabase
        .from("institution_communication_settings")
        .select("id")
        .eq("institution_id", settings.institution_id)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("institution_communication_settings")
          .update(settings)
          .eq("institution_id", settings.institution_id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("institution_communication_settings")
          .insert(settings);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["communication-settings"] });
      toast.success("Communication settings saved");
    },
    onError: (error: Error) => {
      toast.error("Failed to save settings: " + error.message);
    },
  });

  return { settings: settingsQuery.data, isLoading: settingsQuery.isLoading, upsertSettings };
}
