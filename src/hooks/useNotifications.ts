import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Tables } from "@/integrations/supabase/types";
import { getCurrentUser } from "@/lib/auth";

// Only the columns the notification surfaces actually render. `metadata` is
// back on the list because the bell uses `metadata.conversation_id` to open
// the exact thread a message notification points at; the list itself now
// loads only while the popover is open (20 rows), not on a poll, so the
// jsonb no longer ships to every user every minute.
export type Notification = Pick<
  Tables<"notifications">,
  "id" | "user_id" | "type" | "title" | "message" | "link" | "is_read" | "created_at" | "metadata"
>;

const NOTIFICATION_COLUMNS =
  "id, user_id, type, title, message, link, is_read, created_at, metadata";

export function useNotifications(limit = 20, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ["notifications", limit],
    queryFn: async () => {
      const user = await getCurrentUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("notifications")
        .select(NOTIFICATION_COLUMNS)
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return (data ?? []) as Notification[];
    },
    // No poll here: useNotificationRealtime invalidates this key on INSERT,
    // and the list only matters while the bell popover is open — callers
    // pass enabled accordingly. The previous unconditional 60s poll ran for
    // every logged-in user on every page (§23: 3-5K users × 1 req/min).
    enabled: options?.enabled ?? true,
    // "Show older" bumps `limit`, which is part of the key: keep the current
    // page on screen while the larger one loads instead of flashing skeletons.
    placeholderData: keepPreviousData,
    // 30s (below the 60s floor) is justified: the query is disabled while
    // the popover is closed, so this only decides whether a re-open within
    // half a minute re-fetches. Realtime invalidation covers new rows.
    staleTime: 30_000,
  });
}

export function useUnreadNotificationCount() {
  return useQuery({
    queryKey: ["unread-notification-count"],
    queryFn: async () => {
      const user = await getCurrentUser();
      if (!user) return 0;

      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (error) throw error;
      return count || 0;
    },
    // 60s head-count poll (≥30s floor, §23.2): realtime covers INSERTs
    // instantly; this is the fallback for missed websocket events and
    // cross-device read-state changes. head:true — no rows shipped.
    refetchInterval: 60000,
    staleTime: 60_000,
  });
}

/**
 * Marks a specific set of notifications as read in ONE request. The bell
 * calls this when its popover closes with the ids it actually displayed, so
 * "viewing" a notification is what marks it read (not just clicking it).
 *
 * Idempotent: the `.eq("is_read", false)` guard means a retry or an overlap
 * with a per-row mark is a no-op UPDATE of zero rows.
 */
export function useMarkNotificationsSeen() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationIds: string[]) => {
      if (notificationIds.length === 0) return 0;

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", notificationIds)
        .eq("is_read", false);

      if (error) throw error;
      return notificationIds.length;
    },
    onSuccess: (markedCount) => {
      // Drop the badge immediately; the invalidation below fetches the
      // server truth (there may be unread rows beyond the page we showed).
      queryClient.setQueryData<number>(["unread-notification-count"], (old) =>
        Math.max(0, (old ?? 0) - markedCount),
      );
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const user = await getCurrentUser();
      if (!user) throw new Error("Not authenticated");

      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
  });
}

// Hook to create notifications (for internal use, not usually called directly)
export function useCreateNotification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (notification: {
      userId: string;
      type: string;
      title: string;
      message: string;
      link?: string;
      metadata?: Record<string, string | number | boolean>;
    }) => {
      const insertData = {
        user_id: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        link: notification.link,
        metadata: notification.metadata ? JSON.parse(JSON.stringify(notification.metadata)) : {},
      };

      const { error } = await supabase.from("notifications").insert([insertData]);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });
    },
  });
}
