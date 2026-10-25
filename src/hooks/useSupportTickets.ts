import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { getAppUrl } from "@/lib/appUrl";
import { toastError, toastWarning } from "@/lib/toast";

/**
 * Reporter-side Salci Support: the reporter's own tickets and the two-way
 * conversation on each of them.
 *
 * Every read here is an RPC, never a table read. `reported_issues` SELECT is
 * super-admin-only (Phase 1 narrowed it), and `support_messages` has a SELECT
 * policy but deliberately NO insert/update/delete policy, so the whole write
 * path is the SECURITY DEFINER `post_support_message`. That is what makes the
 * internal/external split unforgeable from a client.
 *
 * Design: docs/superpowers/specs/2026-08-31-salci-support-workflow-design.md
 */

/**
 * The three reporter tabs and the ticket statuses each one covers.
 * `all` is also the canonical status vocabulary, and the CHECK constraint on
 * `reported_issues.status` allows exactly these four values.
 */
export const SUPPORT_TAB_STATUSES = {
  active: ["open", "in_progress"],
  resolved: ["resolved", "closed"],
  all: ["open", "in_progress", "resolved", "closed"],
} as const;

export type SupportTab = keyof typeof SUPPORT_TAB_STATUSES;
export type SupportTicketStatus = (typeof SUPPORT_TAB_STATUSES)["all"][number];

export const SUPPORT_STATUS_LABELS: Record<SupportTicketStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  closed: "Closed",
};

/**
 * Copied verbatim from AdminIssuesPage's STATUS_TONES so a ticket reads
 * identically to the reporter and to SALCI. If one side ever changes, change
 * both: a status that looks amber on one surface and grey on the other is a
 * support conversation about the support tool.
 */
export const SUPPORT_STATUS_TONES: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  closed: "bg-ink-400/10 text-ink-600 border-ink-400/30",
};

export interface SupportAttachment {
  path: string;
  name: string;
  size: number;
  type: string;
}

export interface SupportMessage {
  id: string;
  author_side: "reporter" | "salci" | "system";
  author_name: string | null;
  kind: "message" | "system";
  body: string;
  is_internal: boolean;
  attachments: SupportAttachment[];
  created_at: string;
}

export interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  status: SupportTicketStatus;
  category: string | null;
  priority: number | null;
  reporter_name: string | null;
  reporter_email: string | null;
  reporter_role: string | null;
  institution_name: string | null;
  created_at: string;
  last_message_at: string | null;
  resolved_at: string | null;
  first_response_at: string | null;
  message_count: number;
  has_unread: boolean;
}

/** Returned by `post_support_message` so the caller can fire the notification
 *  email without a second round trip. Wired up in Phase 5. */
export interface SupportNotify {
  to_user_id: string;
  to_email: string | null;
  to_name: string | null;
  kind: "support_reply" | "support_status_changed" | "support_reopened";
  ticket_id: string;
  subject: string;
  preview: string;
}

/**
 * The stat-tile counts, aggregated in Postgres over EVERY ticket the caller
 * owns. They are not derived from the returned page, so they stay correct past
 * the 100-row clamp.
 *
 * SEMANTICS, read this before labelling anything with `awaiting`: the server
 * computes it as `last_message_at > coalesce(reporter_last_read_at, epoch)`,
 * which counts a ticket whose newest message is the REPORTER'S OWN. The sibling
 * per-ticket `has_unread` flag additionally requires `author_side <> 'reporter'`,
 * so the two disagree by exactly the reporter's own unread-stamped replies.
 * `awaiting` therefore means "this ticket has activity you have not read",
 * NOT "SALCI replied and is waiting on you". SupportPage labels it accordingly;
 * see the comment on its tile.
 */
export interface SupportTicketCounts {
  active: number;
  awaiting: number;
  resolved: number;
  total: number;
}

interface ListMyTicketsPayload {
  tickets: SupportTicket[];
  has_more: boolean;
  counts: SupportTicketCounts;
}

export interface SupportThreadPayload {
  ticket: SupportTicket;
  messages: SupportMessage[];
  has_more: boolean;
}

export interface MySupportTickets {
  tickets: SupportTicket[];
  counts: SupportTicketCounts;
  hasMore: boolean;
}

const EMPTY_SUPPORT_COUNTS: SupportTicketCounts = {
  active: 0,
  awaiting: 0,
  resolved: 0,
  total: 0,
};

const SUPPORT_STALE_TIME = 60_000;
/** The RPC clamps `p_limit` to 100 server-side; ask for the clamp. */
const SUPPORT_LIST_LIMIT = 100;
/** `get_support_thread` is cursor-paginated on created_at; this is one page. */
const SUPPORT_THREAD_LIMIT = 50;

/**
 * Best-effort courtesy email for a support write.
 *
 * The in-app notification is written inside the RPC transaction and is the
 * durable channel, so this must NEVER fail the mutation: the message is
 * already saved by the time we get here. A failure is a warning, not an
 * error, and it is never rethrown.
 *
 * A null payload is the normal case, not an edge case: `post_support_message`
 * builds `notify` inside its NOT-internal branch, so an internal SALCI note
 * returns NULL here and produces no notification and no email.
 *
 * Invoked through `invokeEdgeFunction`, not `supabase.functions.invoke`,
 * which sends an empty Bearer token in this client setup (CLAUDE.md §21).
 *
 * The app origin is passed because the portal runs on two production
 * frontends against one Supabase project. The function validates it against
 * the SUPPORT_APP_ORIGINS allowlist and falls back to the first entry on a
 * miss, so an unexpected origin can never reach an email link. A native build
 * sends the canonical URL from VITE_PUBLIC_URL (via `getAppUrl`), since its
 * own origin is capacitor://localhost.
 */
export async function sendSupportNotifyEmail(
  notify: SupportNotify | null | undefined,
): Promise<void> {
  if (!notify) return;
  try {
    await invokeEdgeFunction<{ sent: boolean; reason?: string }>("support-notify-email", {
      notify,
      // Canonical app URL, not window.location.origin: inside the native shell the origin is capacitor://localhost.
      origin: getAppUrl(),
    });
  } catch (err) {
    console.error("[support] notification email failed", err);
    toastWarning(
      "Saved, but the email alert did not go out.",
      "The other side will still see it in the portal.",
    );
  }
}

/**
 * The caller's own tickets, sliced to one tab.
 *
 * Scale Gate item 1 (bounded): `p_limit` is 100 and the RPC clamps it.
 * Scale Gate item 2 (server-side aggregation): the tile counts come back in
 * `payload.counts`, aggregated in Postgres over every ticket the caller owns.
 * Counting the returned page in the browser would both violate the gate and go
 * quietly wrong the moment a reporter passes the 100-row clamp, because the
 * page it counted is not the whole history.
 *
 * `tab` is deliberately NOT part of the query key. `list_my_support_tickets`
 * takes no status argument, so every tab would fetch a byte-identical payload:
 * keying on the tab meant visiting all three fired three identical RPCs and
 * cached three copies of the same 100 rows and the same counts. One fetch,
 * three views. The tab slice happens in `select`, which react-query memoises
 * per (data, select identity), so switching tabs re-slices a cached array and
 * never touches the network.
 *
 * The slice computes no number: the counts are passed through from the server
 * payload untouched.
 *
 * `userId` is in the query key on purpose: ["tasks-assigned-by-me"] omits it
 * and can serve a previous session's list after a user switch.
 */
export function useMySupportTickets(tab: SupportTab) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const selectTab = useCallback(
    (payload: MySupportTickets): MySupportTickets => {
      const wanted = SUPPORT_TAB_STATUSES[tab] as readonly SupportTicketStatus[];
      return {
        ...payload,
        tickets: payload.tickets.filter((t) => wanted.includes(t.status)),
      };
    },
    [tab],
  );

  return useQuery({
    queryKey: ["support-my-tickets", userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<MySupportTickets> => {
      const { data, error } = await supabase.rpc("list_my_support_tickets", {
        p_limit: SUPPORT_LIST_LIMIT,
        p_offset: 0,
      });
      if (error) throw error;

      const payload = (data as unknown as ListMyTicketsPayload | null) ?? {
        tickets: [],
        has_more: false,
        counts: EMPTY_SUPPORT_COUNTS,
      };

      return {
        tickets: payload.tickets ?? [],
        counts: payload.counts ?? EMPTY_SUPPORT_COUNTS,
        hasMore: Boolean(payload.has_more),
      };
    },
    select: selectTab,
    staleTime: SUPPORT_STALE_TIME,
  });
}

/**
 * One ticket's header plus its latest page of messages.
 *
 * Internal SALCI notes are stripped server-side for a reporter, so this hook
 * is safe to mount on both surfaces without a client-side filter that could be
 * forgotten.
 *
 * `refetchOnWindowFocus` is on here and only here: a conversation is exactly
 * the surface where coming back to the tab should show the new reply, and one
 * bounded RPC on focus is far cheaper than a realtime channel (§23).
 */
export function useSupportThread(ticketId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["support-thread", ticketId],
    enabled: Boolean(ticketId) && enabled,
    queryFn: async (): Promise<SupportThreadPayload> => {
      const { data, error } = await supabase.rpc("get_support_thread", {
        p_ticket_id: ticketId as string,
        p_limit: SUPPORT_THREAD_LIMIT,
      });
      if (error) throw error;
      return data as unknown as SupportThreadPayload;
    },
    staleTime: SUPPORT_STALE_TIME,
    refetchOnWindowFocus: true,
  });
}

export interface PostSupportMessageInput {
  ticketId: string;
  body: string;
  isInternal?: boolean;
  attachments?: SupportAttachment[];
  /** Idempotency key. A partial unique index on support_messages.client_token
   *  makes a repeated post return the SAME message instead of a duplicate, so
   *  a retry after a flaky network is safe. Hold one token per draft. */
  clientToken: string;
}

export interface PostSupportMessageResult {
  message_id: string;
  status: SupportTicketStatus;
  notify: SupportNotify | null;
}

/**
 * The single write path for the conversation. Message, `last_message_at`,
 * `first_response_at`, any implicit status move, its system row and the in-app
 * notification all happen inside this one transaction (Scale Gate item 6).
 */
export function usePostSupportMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: PostSupportMessageInput): Promise<PostSupportMessageResult> => {
      const { data, error } = await supabase.rpc("post_support_message", {
        p_ticket_id: input.ticketId,
        p_body: input.body,
        p_is_internal: input.isInternal ?? false,
        p_attachments: (input.attachments ?? []) as unknown as Json,
        p_client_token: input.clientToken,
      });
      if (error) throw error;
      return data as unknown as PostSupportMessageResult;
    },
    onSuccess: (data, variables) => {
      // Fire and forget: the message and its in-app notification are already
      // committed, so email failure must not surface as a failed post. `notify`
      // is NULL on an internal note, and the helper no-ops on it.
      void sendSupportNotifyEmail(data.notify);

      queryClient.invalidateQueries({ queryKey: ["support-thread", variables.ticketId] });
      for (const key of ["support-my-tickets", "support-inbox", "support-inbox-counts", "support-inbox-stats"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't send your message.",
        context: "postSupportMessage",
      }),
  });
}

/**
 * Stamps `reporter_last_read_at` or `salci_last_read_at` by caller side. The
 * RPC decides which, so both surfaces call it identically. Naturally
 * idempotent (Scale Gate item 5).
 */
export function useMarkSupportTicketRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (ticketId: string) => {
      const { error } = await supabase.rpc("mark_support_ticket_read", {
        p_ticket_id: ticketId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      for (const key of ["support-my-tickets", "support-inbox", "support-inbox-counts", "support-inbox-stats"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
    // Deliberately NOT toasted. This is a background read receipt the user
    // never asked for; a failed stamp costs an unread dot, and interrupting
    // someone reading a support reply with an error toast is worse than that.
    // Every user-initiated mutation in this file does route through toastError.
    onError: (error: Error) => {
      console.warn("[support] mark read failed:", error.message);
    },
  });
}
