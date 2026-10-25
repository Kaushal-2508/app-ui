import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PublishJobStatus =
  | "queued"
  | "computing_ranks"
  | "generating_pdfs"
  | "sending_emails"
  | "completed"
  | "failed";

export type PublishJob = {
  id: string;
  oly_school_id: string;
  status: PublishJobStatus;
  total_students: number;
  processed_students: number;
  failed_students: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export function useOlympiadPublishJob(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "publish-job", olySchoolId],
    queryFn: async (): Promise<PublishJob | null> => {
      if (!olySchoolId) return null;
      const { data, error } = await supabase
        .from("oly_publish_jobs")
        .select(
          "id, oly_school_id, status, total_students, processed_students, failed_students, error, started_at, completed_at",
        )
        .eq("oly_school_id", olySchoolId)
        .maybeSingle();
      if (error) throw error;
      return data as PublishJob | null;
    },
    enabled: !!olySchoolId,
    // §23.2: 5s poll is justified — admin watches the pipeline progress
    // through ~5 minutes. Polling stops once status hits completed/failed.
    refetchInterval: (q) => {
      const s = q.state.data?.status;
      return s === "completed" || s === "failed" ? false : 5_000;
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
  });
}
