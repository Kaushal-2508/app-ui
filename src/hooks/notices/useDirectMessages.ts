import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";

import type { RecipientRole } from "./types";

export interface MessageRecipient {
  user_id: string;
  full_name: string | null;
  /** Classes for a student or teacher, wings for a coordinator. */
  detail: string | null;
}

const PAGE_SIZE = 30;
type Cursor = { name: string; id: string } | null;

/**
 * People the signed-in user may message, filtered by role and optionally by
 * class, keyset-paginated.
 *
 * Server-side rather than a client filter over a full fetch: the school in
 * front of us has 253 students, and PostgREST silently truncates an unbounded
 * select at 1000 rows, so a bigger roster would quietly lose people from the
 * picker (§23).
 */
export function useMessageRecipients(
  role: RecipientRole,
  search: string,
  classId: string | null,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: ["messages", "recipients", role, search, classId ?? "any"],
    initialPageParam: null as Cursor,
    queryFn: async ({
      pageParam,
    }): Promise<{ rows: MessageRecipient[]; nextCursor: Cursor }> => {
      const { data, error } = await supabase.rpc("list_message_recipients", {
        _role: role,
        _search: search.trim() || undefined,
        _class_id: classId ?? undefined,
        _after_name: pageParam?.name ?? undefined,
        _after_id: pageParam?.id ?? undefined,
        _limit: PAGE_SIZE,
      });
      if (error) throw error;
      const rows: MessageRecipient[] = (data ?? []).map((r) => ({
        user_id: r.user_id,
        full_name: r.full_name,
        detail: r.detail,
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
    getNextPageParam: (p) => p.nextCursor,
    enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Sends one body to many people as SEPARATE direct conversations.
 *
 * Each recipient gets a normal 1:1 thread, reusing the existing one when there
 * already is one, so a send lands in the thread they know rather than beside
 * it. Nobody is put in a room with the other recipients.
 *
 * `batchId` is generated per send, so a double-click or a retry is a no-op
 * rather than a second copy in every thread.
 */
export function useSendDirectMessages() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      batchId: string;
      recipientIds: string[];
      body: string;
    }) => {
      const { data, error } = await supabase.rpc("send_direct_messages", {
        _batch_id: input.batchId,
        _recipient_ids: input.recipientIds,
        _body: input.body,
      });
      if (error) throw error;
      return (data ?? 0) as number;
    },
    onSuccess: (sent) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      if (sent === 0) {
        toast.success("Already sent");
        return;
      }
      toast.success(
        sent === 1 ? "Message sent" : `Message sent to ${sent} people`,
      );
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't send that message.",
        context: "sendDirectMessages",
      }),
  });
}
