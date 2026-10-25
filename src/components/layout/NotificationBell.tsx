import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { NotificationPanel } from "@/components/layout/NotificationPanel";
import { useAuth } from "@/hooks/useAuth";
import {
  useNotifications,
  useUnreadNotificationCount,
  useMarkNotificationRead,
  useMarkNotificationsSeen,
  useMarkAllNotificationsRead,
  type Notification,
} from "@/hooks/useNotifications";
import { useNotificationRealtime } from "@/hooks/useNotificationRealtime";
import { resolveNotificationTarget } from "@/lib/notificationLink";
import { toastError } from "@/lib/toast";

/** First page size; "Show older" grows the list in steps up to the cap. */
const PAGE_SIZE = 20;
const MAX_ROWS = 100;

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const navigate = useNavigate();

  // Session user from context (§23: never supabase.auth.getUser() here).
  const { user } = useAuth();
  useNotificationRealtime(user?.id);

  // The list only loads while the popover is open; the badge needs just the
  // unread count, and realtime invalidation keeps the list fresh on open.
  const {
    data: notifications,
    isLoading,
    isFetching,
    isError,
    refetch,
  } = useNotifications(limit, { enabled: open });
  const { data: unreadCount = 0 } = useUnreadNotificationCount();
  const markRead = useMarkNotificationRead();
  const markSeen = useMarkNotificationsSeen();
  const markAllRead = useMarkAllNotificationsRead();

  // Mark-as-read-on-view: whatever was on screen when the popover closes is
  // marked read in one request. Refs keep the latest list and the ids already
  // marked by a row click during this open session, so the effect never
  // sends a stale set or a duplicate.
  const notificationsRef = useRef(notifications);
  notificationsRef.current = notifications;
  const markedThisSessionRef = useRef<Set<string>>(new Set());
  const wasOpenRef = useRef(false);
  const { mutate: mutateSeen } = markSeen;

  useEffect(() => {
    if (open) {
      markedThisSessionRef.current = new Set();
    } else if (wasOpenRef.current) {
      const marked = markedThisSessionRef.current;
      const ids = (notificationsRef.current ?? [])
        .filter((n) => !n.is_read && !marked.has(n.id))
        .map((n) => n.id);
      if (ids.length > 0) {
        mutateSeen(ids, {
          // Background bookkeeping: a failure here just leaves the badge in
          // place until the next open, so it is logged, not toasted.
          onError: (err) => console.warn("[NotificationBell] mark seen failed", err),
        });
      }
      // Next open starts from the first page again.
      setLimit(PAGE_SIZE);
    }
    wasOpenRef.current = open;
  }, [open, mutateSeen]);

  const handleNotificationClick = (notification: Notification) => {
    // Shared with the app's tapped push notification (src/lib/notificationLink.ts).
    const target = resolveNotificationTarget(notification);
    if (target) {
      // Closing marks everything on screen (this row included) as read.
      setOpen(false);
      navigate(target);
      return;
    }
    // No destination: the popover stays open, so give immediate feedback.
    if (!notification.is_read && !markedThisSessionRef.current.has(notification.id)) {
      markedThisSessionRef.current.add(notification.id);
      markRead.mutate(notification.id);
    }
  };

  const handleMarkAllRead = () => {
    if (markAllRead.isPending) return;
    markAllRead.mutate(undefined, {
      onError: (err) =>
        toastError(err, { fallback: "Couldn't mark notifications as read.", context: "markAllNotificationsRead" }),
    });
  };

  const rows = notifications ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-full"
          aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-none text-destructive-foreground shadow-sm"
            >
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>

      <NotificationPanel
        rows={rows}
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        unreadCount={unreadCount}
        canShowOlder={rows.length >= limit && limit < MAX_ROWS}
        markAllPending={markAllRead.isPending}
        onSelect={handleNotificationClick}
        onMarkAllRead={handleMarkAllRead}
        onShowOlder={() => setLimit((l) => Math.min(l + PAGE_SIZE, MAX_ROWS))}
        onRetry={() => void refetch()}
      />
    </Popover>
  );
}
