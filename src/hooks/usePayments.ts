import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface PaymentRecord {
  id: string;
  institution_id: string;
  amount: number;
  currency: string;
  status: string;
  payment_type: string;
  description: string | null;
  invoice_number: string | null;
  payment_date: string | null;
  due_date: string | null;
  payment_method: string | null;
  transaction_id: string | null;
  created_at: string;
  institutions?: {
    name: string;
    code: string;
  };
}

interface InstitutionSubscription {
  id: string;
  institution_id: string;
  plan_name: string;
  plan_type: string;
  monthly_amount: number;
  status: string;
  billing_cycle_start: string | null;
  next_billing_date: string | null;
  started_at: string | null;
  institutions?: {
    name: string;
    code: string;
  };
}

interface RevenueMetrics {
  totalRevenue: number;
  monthlyRecurringRevenue: number;
  activeSubscriptions: number;
  avgRevenuePerSchool: number;
}

export function useRevenueAnalytics() {
  return useQuery({
    queryKey: ["revenue-analytics"],
    queryFn: async () => {
      // Get all payments
      const { data: payments, error: paymentsError } = await supabase
        .from("payment_records")
        .select(`
          *,
          institutions (name, code)
        `)
        .order("created_at", { ascending: false });

      if (paymentsError) throw paymentsError;

      // Get all subscriptions
      const { data: subscriptions, error: subsError } = await supabase
        .from("institution_subscriptions")
        .select(`
          *,
          institutions (name, code)
        `)
        .order("institution_id");

      if (subsError) throw subsError;

      // Calculate metrics
      const completedPayments = payments?.filter(p => p.status === "completed") || [];
      const totalRevenue = completedPayments.reduce((sum, p) => sum + Number(p.amount), 0);
      
      const activeSubscriptions = subscriptions?.filter(s => s.status === "active") || [];
      const monthlyRecurringRevenue = activeSubscriptions.reduce((sum, s) => sum + Number(s.monthly_amount), 0);

      const avgRevenuePerSchool = activeSubscriptions.length > 0 
        ? monthlyRecurringRevenue / activeSubscriptions.length 
        : 0;

      const metrics: RevenueMetrics = {
        totalRevenue,
        monthlyRecurringRevenue,
        activeSubscriptions: activeSubscriptions.length,
        avgRevenuePerSchool,
      };

      // Institution billing data
      const institutionBilling = subscriptions?.map(sub => ({
        id: sub.id,
        institutionId: sub.institution_id,
        institutionName: sub.institutions?.name || "Unknown",
        institutionCode: sub.institutions?.code || "",
        planName: sub.plan_name,
        status: sub.status,
        monthlyAmount: Number(sub.monthly_amount),
        nextBillingDate: sub.next_billing_date,
        startedAt: sub.started_at,
        // Find last payment for this institution
        lastPayment: payments?.find(p => p.institution_id === sub.institution_id && p.status === "completed"),
      })) || [];

      return {
        metrics,
        payments: payments || [],
        subscriptions: subscriptions || [],
        institutionBilling,
      };
    },
  });
}

export function useInstitutionBilling(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-billing", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;

      // Get subscription
      const { data: subscription, error: subError } = await supabase
        .from("institution_subscriptions")
        .select(`
          *,
          institutions (name, code)
        `)
        .eq("institution_id", institutionId)
        .single();

      if (subError && subError.code !== "PGRST116") throw subError;

      // Get payments
      const { data: payments, error: payError } = await supabase
        .from("payment_records")
        .select("*")
        .eq("institution_id", institutionId)
        .order("created_at", { ascending: false });

      if (payError) throw payError;

      return {
        subscription,
        payments: payments || [],
        totalPaid: payments?.filter(p => p.status === "completed").reduce((sum, p) => sum + Number(p.amount), 0) || 0,
      };
    },
    enabled: !!institutionId,
  });
}

export function useAuditLogs(filters?: { entityType?: string; institutionId?: string }) {
  return useQuery({
    queryKey: ["audit-logs", filters],
    queryFn: async () => {
      let query = supabase
        .from("system_audit_logs")
        .select(`
          *,
          profiles:actor_id (full_name, email)
        `)
        .order("created_at", { ascending: false })
        .limit(100);

      if (filters?.entityType) {
        query = query.eq("entity_type", filters.entityType);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
  });
}
