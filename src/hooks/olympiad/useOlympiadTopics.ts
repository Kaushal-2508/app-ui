import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OlympiadTopic = {
  id: string;
  subject_id: string;
  grade_level_id: string;
  name: string;
  status: "active" | "archived";
  display_order: number;
};

export function useOlympiadTopics(subjectId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "topics", subjectId],
    queryFn: async (): Promise<OlympiadTopic[]> => {
      if (!subjectId) return [];
      const { data, error } = await supabase
        .from("oly_topics")
        .select("id, subject_id, grade_level_id, name, status, display_order")
        .eq("subject_id", subjectId)
        .order("display_order")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        subject_id: r.subject_id,
        grade_level_id: r.grade_level_id,
        name: r.name,
        status: r.status as OlympiadTopic["status"],
        display_order: r.display_order,
      }));
    },
    enabled: !!subjectId,
    staleTime: 60_000,
  });
}

export type OlympiadTopicInput = {
  id?: string;
  subject_id: string;
  grade_level_id: string;
  name: string;
  status?: "active" | "archived";
  display_order?: number;
};

export function useUpsertOlympiadTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OlympiadTopicInput) => {
      const payload = {
        subject_id: input.subject_id,
        grade_level_id: input.grade_level_id,
        name: input.name,
        status: input.status ?? "active",
        display_order: input.display_order ?? 0,
      };
      if (input.id) {
        const { error } = await supabase
          .from("oly_topics")
          .update(payload)
          .eq("id", input.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("oly_topics").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "topics", vars.subject_id] });
      toast.success("Topic saved");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't save topic.", context: "useUpsertOlympiadTopic" }),
  });
}
