import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/**
 * The diary has no read receipts in v1 (see the design spec), so "is there
 * anything new in my diary?" is answered by the in-app notifications that
 * `diary_write_entry` fans out: one `diary_<kind>` row per addressed student.
 * Counting the unread ones is exactly the number of entries the reader has
 * not been shown yet. The count is a server-side head request (no rows ship);
 * the key sits under "unread-notification-count" so the bell's realtime
 * invalidation and mark-all-read already refresh it with no extra wiring.
 */
export const DIARY_NOTIFICATION_TYPE_PATTERN = "diary_%";

export function useUnreadDiaryCount(userId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: ["unread-notification-count", "diary", userId ?? null],
    queryFn: async (): Promise<number> => {
      if (!userId) return 0;
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false)
        .like("type", DIARY_NOTIFICATION_TYPE_PATTERN);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: enabled && !!userId,
    staleTime: 60_000,
    // Same cadence and reasoning as useUnreadNotificationCount: realtime
    // covers INSERTs instantly; this catches missed websocket events and a
    // read stamped on another device. head:true, so it costs one count.
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Opening the diary tab is the reader's "I have seen it": every unread diary
 * notification for this user is stamped read in one UPDATE, so the tab badge
 * and the bell stop counting entries the reader is now looking at.
 * Idempotent: a second call finds nothing unread and changes nothing.
 */
export function useMarkDiaryNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false)
        .like("type", DIARY_NOTIFICATION_TYPE_PATTERN);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
    // Bookkeeping the reader did not ask for: a failure here must not toast
    // over the diary they opened. The badge simply stays until the next try.
    onError: (e: Error) => console.error("[markDiaryNotificationsRead]", e),
  });
}
