import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type DashboardContext = {
  ok: true;
  student: {
    id: string;
    oly_school_id: string;
    grade_level_id: string;
    full_name: string;
    roll_number: string;
    section_label: string | null;
    subject_ids: string[];
    date_of_birth: string;
  };
  school_name: string;
  campaign_year: number;
  batch: {
    id: string;
    batch_label: string;
    scheduled_at: string;
    pin_expiry_minutes: number;
    pin_first_used_at: string | null;
    status: string;
    is_absentees: boolean;
  } | null;
  subjects: Array<{ id: string; name: string }>;
  study_material_count: number;
  attempt: {
    id: string;
    status: "in_progress" | "submitted" | "auto_submitted_timer" | "auto_submitted_violation" | "auto_submitted_disconnect";
    submitted_at: string | null;
    submit_reason: string | null;
  } | null;
} | { ok: false; reason: string };

export function useOlympiadStudentDashboard() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "student-dashboard", user?.id],
    queryFn: async (): Promise<DashboardContext> => {
      if (!user?.id) return { ok: false, reason: "not_authenticated" };
      const { data, error } = await supabase.rpc("oly_student_dashboard_context");
      if (error) throw error;
      return data as DashboardContext;
    },
    enabled: !!user?.id,
    // §23.2: dashboard data is moderate volatility (batch + study material counts)
    staleTime: 60_000,
  });
}
