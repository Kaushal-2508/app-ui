import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import type {
  NoticeReachRow,
  NoticeRecipientRow,
  RecipientStatusFilter,
} from "./types";

const PAGE_SIZE = 50;

/**
 * Per-role reach for one notice: total addressed, how many read it, how many
 * acknowledged.
 *
 * Aggregated in SQL, never by counting fetched rows -- a whole-school notice
 * addresses ~1,500 people and the client only ever needs three numbers per
 * role. Returns an empty array for a viewer who does not oversee the notice
 * (the RPC gates on notice_can_oversee), so a plain recipient simply sees no
 * reach panel rather than an error.
 */
export function useNoticeReach(noticeId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["notices", "reach", noticeId],
    queryFn: async (): Promise<NoticeReachRow[]> => {
      if (!noticeId) return [];
      const { data, error } = await supabase.rpc("notice_reach", {
        _notice_id: noticeId,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        recipient_role: r.recipient_role,
        total: r.total,
        read_count: r.read_count,
        ack_count: r.ack_count,
      }));
    },
    enabled: enabled && !!noticeId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Keyset cursor: the list orders by (full_name, user_id). */
type Cursor = { name: string; id: string } | null;

/**
 * Paginated roster for one notice, optionally filtered to who has not read it.
 * Keyset rather than OFFSET so page N costs the same as page 1.
 */
export function useNoticeRecipients(
  noticeId: string | null,
  status: RecipientStatusFilter = "all",
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ["notices", "recipients", noticeId, status],
    initialPageParam: null as Cursor,
    queryFn: async ({
      pageParam,
    }): Promise<{ rows: NoticeRecipientRow[]; nextCursor: Cursor }> => {
      if (!noticeId) return { rows: [], nextCursor: null };
      const { data, error } = await supabase.rpc("notice_recipient_list", {
        _notice_id: noticeId,
        _status: status,
        _after_name: pageParam?.name ?? undefined,
        _after_id: pageParam?.id ?? undefined,
        _limit: PAGE_SIZE,
      });
      if (error) throw error;
      const rows: NoticeRecipientRow[] = (data ?? []).map((r) => ({
        user_id: r.user_id,
        full_name: r.full_name,
        recipient_role: r.recipient_role,
        added_reason: r.added_reason,
        read_at: r.read_at,
        acknowledged_at: r.acknowledged_at,
      }));
      const last = rows[rows.length - 1];
      return {
        rows,
        nextCursor:
          rows.length === PAGE_SIZE && last
            ? { name: last.full_name ?? "", id: last.user_id }
            : null,
      };
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: enabled && !!noticeId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
