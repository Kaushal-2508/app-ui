import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type PublishedResult =
  | {
      ok: true;
      result_id: string;
      full_name: string;
      roll_number: string;
      class_label: string;
      section_label: string | null;
      total_marks_obtained: number;
      total_max_marks: number;
      percentage: number;
      subject_scores: Array<{
        subject_id: string;
        subject_name: string;
        correct: number;
        total: number;
        marks_obtained: number;
        marks_max: number;
      }>;
      total_time_seconds: number | null;
      class_rank: number | null;
      class_total: number | null;
      school_rank: number | null;
      school_total: number | null;
      certificate_tier: "gold" | "silver" | "bronze" | "participation" | "absent";
      certificate_id: string;
      result_pdf_path: string | null;
      certificate_pdf_path: string | null;
      published_at: string;
    }
  | { ok: false; reason: string };

/** Self-lookup by default; pass a studentId for the school-admin view of a
 *  specific student (the RPC gates via oly_student_can_read). */
export function useOlympiadPublishedResult(studentId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["olympiad", "published-result", user?.id, studentId ?? "self"],
    queryFn: async (): Promise<PublishedResult> => {
      if (!user?.id) return { ok: false, reason: "not_authenticated" };
      const { data, error } = await supabase.rpc(
        "oly_get_published_result",
        studentId ? { p_student_id: studentId } : {},
      );
      if (error) throw error;
      return data as PublishedResult;
    },
    enabled: !!user?.id,
    staleTime: 60_000,
  });
}
