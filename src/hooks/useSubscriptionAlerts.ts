import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { Json } from "@/integrations/supabase/types";

export interface SubscriptionAlert {
  id: string;
  institution_id: string;
  alert_type: string;
  due_date: string | null;
  message: string;
  metadata: Json | null;
  is_read: boolean | null;
  is_dismissed: boolean | null;
  created_at: string | null;
  institution?: {
    name: string;
    code: string;
  };
}

// Fetch all subscription alerts (for super admin)
export function useSubscriptionAlerts() {
  return useQuery({
    queryKey: ["subscription-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscription_alerts")
        .select(`
          *,
          institution:institutions(name, code)
        `)
        .order("due_date", { ascending: true });

      if (error) throw error;
      return (data || []) as SubscriptionAlert[];
    },
  });
}

// Fetch alerts for a specific institution
export function useInstitutionAlerts(institutionId: string | null) {
  return useQuery({
    queryKey: ["subscription-alerts", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      const { data, error } = await supabase
        .from("subscription_alerts")
        .select("*")
        .eq("institution_id", institutionId)
        .eq("is_dismissed", false)
        .order("due_date", { ascending: true });

      if (error) throw error;
      return (data || []) as SubscriptionAlert[];
    },
    enabled: !!institutionId,
  });
}

// Mark alert as read
export function useMarkAlertRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("subscription_alerts")
        .update({ is_read: true })
        .eq("id", alertId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-alerts"] });
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to mark alert as read");
    },
  });
}

// Dismiss an alert
export function useDismissAlert() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("subscription_alerts")
        .update({ is_dismissed: true })
        .eq("id", alertId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-alerts"] });
      toast.success("Alert dismissed");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to dismiss alert");
    },
  });
}

// Generate alerts (trigger the database function)
export function useGenerateAlerts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("generate_subscription_alerts");
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["subscription-alerts"] });
      toast.success("Alerts generated successfully");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to generate alerts");
    },
  });
}

// Get pending alerts count
export function usePendingAlertsCount() {
  return useQuery({
    queryKey: ["subscription-alerts-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("subscription_alerts")
        .select("*", { count: "exact", head: true })
        .eq("is_dismissed", false);

      if (error) throw error;
      return count || 0;
    },
  });
}
