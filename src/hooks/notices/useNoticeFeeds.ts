import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import type { InboxNotice, NoticeAttachment, OutboxNotice } from "./types";
import { toAttachments } from "./types";

const PAGE_SIZE = 20;

/** Keyset cursor. Both feeds order by (published_at DESC, id DESC), so the
 *  cursor is the last row's pair -- never an OFFSET, which re-scans everything
 *  it skips (CLAUDE.md section 23). */
type Cursor = { publishedAt: string; id: string } | null;

interface Page<T> {
  rows: T[];
  nextCursor: Cursor;
}

function nextCursorFrom<T extends { published_at: string; id: string }>(
  rows: T[],
): Cursor {
  if (rows.length < PAGE_SIZE) return null;
  const last = rows[rows.length - 1];
  return { publishedAt: last.published_at, id: last.id };
}

/**
 * Notices addressed to the signed-in user, newest first, with their own
 * read/acknowledged state on each row.
 *
 * One RPC per page rather than a PostgREST embed: the read state lives on
 * notice_recipients, so an embed would either N+1 per notice or force the
 * client to stitch two result sets together.
 */
export function useNoticeInbox() {
  return useInfiniteQuery({
    queryKey: ["notices", "inbox"],
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<Page<InboxNotice>> => {
      const { data, error } = await supabase.rpc("notice_inbox", {
        _before_published_at: pageParam?.publishedAt ?? undefined,
        _before_id: pageParam?.id ?? undefined,
        _limit: PAGE_SIZE,
      });
      if (error) throw error;
      const rows: InboxNotice[] = (data ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        content: r.content,
        type: r.type,
        scope: r.scope,
        priority: r.priority,
        published_at: r.published_at,
        expires_at: r.expires_at,
        requires_acknowledgement: r.requires_acknowledgement,
        attachments: toAttachments(r.attachments),
        publisher_name: r.publisher_name,
        read_at: r.read_at,
        acknowledged_at: r.acknowledged_at,
      }));
      return { rows, nextCursor: nextCursorFrom(rows) };
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * How many notices addressed to the signed-in user are still unread, as the
 * server counts them (notice_unread_count: published, not expired, read_at
 * null). Badges the Notice Board tab on the Communication page.
 *
 * Lives under ["notices", "inbox"] on purpose: useNotificationRealtime
 * invalidates that prefix when a notice_* notification arrives and every
 * notice mutation invalidates ["notices"], so the badge follows both without
 * extra wiring. One integer per call; no rows leave the database (CLAUDE.md 23).
 */
export function useUnreadNoticeCount(enabled = true) {
  return useQuery({
    queryKey: ["notices", "inbox", "unread-count"],
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc("notice_unread_count");
      if (error) throw error;
      return data ?? 0;
    },
    enabled,
    staleTime: 60_000,
    // Same cadence and reasoning as useUnreadNotificationCount: realtime
    // covers new notices instantly; the poll catches a missed websocket event
    // or a notice opened on another device. A single integer per minute.
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * The message and attachments of ONE notice, fetched only when something needs
 * them.
 *
 * The Issued list comes from notice_outbox, which returns reach counts and no
 * body: the message is not what an author scans that list for, and shipping
 * twenty bodies per page to render one is the opposite of what section 23
 * asks for. So the board opens an issued row with the fields the list already
 * has and this fills in the rest, for the single notice actually opened.
 *
 * A direct read rather than another RPC: the notices_select policy already
 * gates the table on can_view_notice(), which is recipient OR overseer, so the
 * same people who may open the row may read it, and no new SECURITY DEFINER
 * surface has to be reviewed.
 */
export function useNoticeBody(noticeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["notices", "body", noticeId],
    queryFn: async (): Promise<{ content: string; attachments: NoticeAttachment[] }> => {
      if (!noticeId) return { content: "", attachments: [] };
      const { data, error } = await supabase
        .from("notices")
        .select("content, attachments")
        .eq("id", noticeId)
        .maybeSingle();
      if (error) throw error;
      return {
        content: data?.content ?? "",
        attachments: toAttachments(data?.attachments),
      };
    },
    enabled: enabled && !!noticeId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Notices the signed-in user issued or oversees, each with server-side reach
 * counts. Scope is decided by notice_can_oversee(): a teacher sees their own, a
 * coordinator theirs plus every notice targeting their wings, an admin the
 * whole school.
 */
export function useNoticeOutbox(enabled = true) {
  return useInfiniteQuery({
    queryKey: ["notices", "outbox"],
    initialPageParam: null as Cursor,
    queryFn: async ({ pageParam }): Promise<Page<OutboxNotice>> => {
      const { data, error } = await supabase.rpc("notice_outbox", {
        _before_published_at: pageParam?.publishedAt ?? undefined,
        _before_id: pageParam?.id ?? undefined,
        _limit: PAGE_SIZE,
      });
      if (error) throw error;
      const rows: OutboxNotice[] = (data ?? []).map((r) => ({
        id: r.id,
        title: r.title,
        type: r.type,
        scope: r.scope,
        priority: r.priority,
        published_at: r.published_at,
        expires_at: r.expires_at,
        requires_acknowledgement: r.requires_acknowledgement,
        publisher_name: r.publisher_name,
        target_summary: r.target_summary,
        recipient_count: r.recipient_count,
        read_count: r.read_count,
        ack_count: r.ack_count,
      }));
      return { rows, nextCursor: nextCursorFrom(rows) };
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
