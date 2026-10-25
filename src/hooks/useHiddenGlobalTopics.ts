import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

const HIDDEN_TOPICS_KEY = ["institution-hidden-topics"] as const;

/**
 * Returns the set of `syllabus_topics.id` values that the caller's institution
 * has chosen to hide from its syllabus view. Powers the global-chapter
 * filter in SyllabusTreeView. Empty set means "nothing hidden".
 */
export function useHiddenGlobalTopics() {
  return useQuery({
    queryKey: HIDDEN_TOPICS_KEY,
    staleTime: 30 * 1000,
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("institution_hidden_topics")
        .select("topic_id");
      if (error) throw error;
      return new Set((data ?? []).map((row) => row.topic_id));
    },
  });
}

/**
 * Hide a globally-seeded chapter from the caller's institution. Reverse op
 * is `useUnhideGlobalTopic`. RLS scopes the insert to the caller's own
 * institution and to admin/coordinator roles.
 */
export function useHideGlobalTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topicId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in.");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      if (!profile?.institution_id) {
        throw new Error("Your account isn't linked to an institution.");
      }

      const { error } = await supabase
        .from("institution_hidden_topics")
        .insert({
          institution_id: profile.institution_id,
          topic_id: topicId,
          hidden_by: user.id,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HIDDEN_TOPICS_KEY });
      invalidateSyllabusCache(queryClient);
      // User-visible language matches the unified Delete UX in
      // SchoolSyllabusPage — under the hood this is a hide for globals,
      // but the user clicked Delete and should see "deleted".
      toast.success("Chapter deleted");
    },
    onError: (error: Error) => {
      toastError(error, {
        fallback: "Couldn't hide that chapter.",
        context: "hideGlobalTopic",
      });
    },
  });
}

/**
 * Bring a previously-hidden chapter back into the caller's institution's
 * syllabus view.
 */
export function useUnhideGlobalTopic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (topicId: string) => {
      const { error, data } = await supabase
        .from("institution_hidden_topics")
        .delete()
        .eq("topic_id", topicId)
        .select("topic_id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error("Couldn't unhide that chapter.");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: HIDDEN_TOPICS_KEY });
      invalidateSyllabusCache(queryClient);
      toast.success("Chapter restored to your syllabus");
    },
    onError: (error: Error) => {
      toastError(error, {
        fallback: "Couldn't restore that chapter.",
        context: "unhideGlobalTopic",
      });
    },
  });
}
