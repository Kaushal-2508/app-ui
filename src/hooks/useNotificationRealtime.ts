import { useEffect, useRef } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNotificationSound } from "./useNotificationSound";
import { useBrowserNotificationPermission } from "./useBrowserNotificationPermission";
import type { RealtimePostgresInsertPayload } from "@supabase/supabase-js";

interface NotificationPayload {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  is_read: boolean;
  created_at: string;
  metadata: Record<string, unknown> | null;
}

export function useNotificationRealtime(userId: string | undefined) {
  const queryClient = useQueryClient();
  const { alertForNotification } = useNotificationSound();
  const { showBrowserNotification, isGranted } = useBrowserNotificationPermission();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch sound preference
  const { data: preferences } = useQuery({
    queryKey: ["user-preferences"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase
        .from("user_preferences")
        .select("push_notifications, sound_notifications")
        .eq("user_id", user.id)
        .single();
      return data;
    },
    enabled: !!userId,
  });

  // Use refs to avoid stale closures
  const preferencesRef = useRef(preferences);
  const isGrantedRef = useRef(isGranted);
  preferencesRef.current = preferences;
  isGrantedRef.current = isGranted;

  useEffect(() => {
    if (!userId) return;

    // Clean up existing channel
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase
      .channel(`user-notifications-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload: RealtimePostgresInsertPayload<NotificationPayload>) => {
          const newNotification = payload.new;
          console.log("[Notifications] Realtime event received:", newNotification.type);

          // Invalidate queries to refresh UI
          queryClient.invalidateQueries({ queryKey: ["notifications"] });
          queryClient.invalidateQueries({ queryKey: ["unread-notification-count"] });

          // A message notification means a thread the reader is in just got
          // a new message. Refresh the conversation list on the same event so
          // the unread dot and the tab badge appear now, not on the next
          // 30s poll. Reuses this channel: no second subscription per user.
          if (newNotification.type === "message") {
            queryClient.invalidateQueries({ queryKey: ["conversations"] });
          }
          // Likewise for the other two Communication tabs. A notice_* row
          // means a notice was just published to this reader: refetch the
          // inbox so the Notice Board's unread badge and list update now.
          // A diary_* row means a new diary entry: refetch the feed (the
          // unread count lives under "unread-notification-count", already
          // invalidated above).
          if (newNotification.type.startsWith("notice_")) {
            queryClient.invalidateQueries({ queryKey: ["notices", "inbox"] });
          }
          if (newNotification.type.startsWith("diary_")) {
            queryClient.invalidateQueries({ queryKey: ["diary", "feed"] });
          }

          // Sound/vibration alert - read from ref for latest value
          const soundEnabled = preferencesRef.current?.sound_notifications ?? true;
          alertForNotification(newNotification.type, soundEnabled);

          // Browser notification
          const pushEnabled = preferencesRef.current?.push_notifications ?? false;
          if (pushEnabled && isGrantedRef.current) {
            showBrowserNotification(
              newNotification.title,
              newNotification.message
            );
          }
        }
      )
      .subscribe((status) => {
        console.log("[Notifications] Realtime subscription status:", status);
      });

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [userId, queryClient, alertForNotification, showBrowserNotification]);
}
