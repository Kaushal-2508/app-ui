import type { Json } from "@/integrations/supabase/types";

/** The columns a notification row needs to be routed. */
export interface RoutableNotification {
  type: string | null;
  link: string | null;
  metadata: Json | null;
}

function metadataString(metadata: Json | null, key: string): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

/**
 * Where a notification should take the reader. Shared by the bell popover on
 * the web and the tapped push notification in the app, so both land on the
 * same screen.
 *
 * Rows written by database triggers and RPCs carry a bare `link` and put the
 * specific id in `metadata`: message fan-out stores `/school/communication`
 * plus `conversation_id`, and `create_task_group` stores `/tasks` plus
 * `task_id`. Those are resolved to the exact thread or task here; the
 * Communication page picks the reader's tab from the `conversation` param and
 * the Tasks page opens the detail panel from `task`. Everything else uses
 * `link` as written.
 */
export function resolveNotificationTarget(n: RoutableNotification): string | null {
  if (n.type === "message") {
    const conversationId = metadataString(n.metadata, "conversation_id");
    if (conversationId) {
      return `/school/communication?conversation=${encodeURIComponent(conversationId)}`;
    }
  }

  const taskId = metadataString(n.metadata, "task_id");
  if (taskId && n.link && /^\/tasks\/?$/.test(n.link)) {
    return `/tasks?task=${encodeURIComponent(taskId)}`;
  }

  // PTM rows carry the bare Communication link plus `ptm_id`: staff land on
  // that PTM's detail, students on the list with the PTM tab open.
  const ptmId = metadataString(n.metadata, "ptm_id");
  if (ptmId && n.type?.startsWith("ptm_") && n.link && /^\/school\/communication(\?|$)/.test(n.link)) {
    return `/school/communication?tab=ptm&ptm=${encodeURIComponent(ptmId)}`;
  }

  return n.link ?? null;
}
