// src/hooks/useReorderTopics.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { toastError } from "@/lib/toast";

interface ReorderInput {
  userId: string;
  subjectId: string;
  orderedTopicIds: string[];
}

/**
 * Persist a user's personal chapter order for one subject. Writes the full
 * 1..N sequence into user_topic_orders (per-user override). Optimistic: the
 * caller reorders its local list immediately; this only persists + reconciles.
 */
export function useReorderTopics() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, orderedTopicIds }: ReorderInput) => {
      const rows = orderedTopicIds.map((topic_id, i) => ({
        user_id: userId,
        topic_id,
        display_order: i + 1,
      }));
      const { error } = await supabase
        .from("user_topic_orders")
        .upsert(rows, { onConflict: "user_id,topic_id" });
      if (error) throw error;
    },
    onError: (err: unknown) =>
      toastError(err, { fallback: "Couldn't save the new order.", context: "reorderChapters" }),
    onSettled: () => invalidateSyllabusCache(queryClient),
  });
}

interface ResetInput {
  userId: string;
  topicIds: string[];
}

/** Clear a user's personal order for the given chapters -> back to default. */
export function useResetTopicOrder() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ userId, topicIds }: ResetInput) => {
      const { error } = await supabase
        .from("user_topic_orders")
        .delete()
        .eq("user_id", userId)
        .in("topic_id", topicIds);
      if (error) throw error;
    },
    onError: (err: unknown) =>
      toastError(err, { fallback: "Couldn't reset the order.", context: "resetChapterOrder" }),
    onSettled: () => invalidateSyllabusCache(queryClient),
  });
}
