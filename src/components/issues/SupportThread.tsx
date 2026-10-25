import * as React from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertCircle, MessageSquare, Paperclip } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { translateError } from "@/lib/errorMessages";
import { cn } from "@/lib/utils";
import {
  useMarkSupportTicketRead,
  useSupportThread,
  type SupportMessage,
} from "@/hooks/useSupportTickets";
import { SupportComposer } from "./SupportComposer";

export interface SupportThreadProps {
  ticketId: string;
  /** Super admin only. Shows the internal-note toggle on the composer. */
  canPostInternal: boolean;
  /** Merged onto the outer stack, so a sheet can set its own spacing. */
  className?: string;
  /**
   * "stacked" (default) renders as a plain list that the enclosing sheet
   * scrolls, composer last. "chat" fills its parent: the messages scroll in
   * their own pane, pinned to the newest, and the composer stays fixed below
   * them above the home indicator. The app opens threads full screen and
   * uses "chat"; the web sheets keep "stacked".
   */
  layout?: "stacked" | "chat";
  /** Passed to the composer: what "Raise this again" does on a closed request. */
  onRaiseAgain?: () => void;
}

function relativeTime(iso: string): string {
  return formatDistanceToNow(new Date(iso), { addSuffix: true });
}

/**
 * Who to print above a bubble.
 *
 * Three rules, each fixing something the raw snapshot got wrong:
 *
 *  1. The viewer is always "You". Without it both sides are just names and you
 *     have to work out which column is yours from the tint alone.
 *  2. A raw email is never shown. `author_name` is a snapshot of
 *     `profiles.full_name`, and for the support owner that value literally IS
 *     "bhanu@salci.in", so the reporter surface was printing a staff mailbox at
 *     every school in the country. Anything with an "@" is cut back to its
 *     local part.
 *  3. On the reporter surface SALCI answers as one team, not as individuals.
 *     A reporter has no use for which staff member typed, and the identity of
 *     the person on the other end is not theirs to have. The SALCI inbox
 *     (canPostInternal) still shows the real name, because there it matters.
 */
function resolveAuthorName(
  message: SupportMessage,
  isViewer: boolean,
  isSalciSurface: boolean,
): string {
  if (isViewer) return "You";

  const fromReporter = message.author_side === "reporter";
  if (!fromReporter && !isSalciSurface) return "SALCI Support";

  const raw = message.author_name?.trim();
  if (!raw) return fromReporter ? "Reporter" : "SALCI Support";

  const at = raw.indexOf("@");
  if (at > 0) return raw.slice(0, at);
  return raw;
}

interface ThreadMessageProps {
  message: SupportMessage;
  /** False when the previous bubble came from the same author: hides the name. */
  showAuthor: boolean;
  /** True on /admin/issues, false on /support. Decides which side is "You". */
  isSalciSurface: boolean;
}

/**
 * One message.
 *
 * Alignment follows the chat convention: the VIEWER's own messages sit on the
 * right, everyone else's on the left. So on /support the reporter is on the
 * right, and on /admin/issues the SALCI replies are. An earlier version pinned
 * the reporter to the right on both surfaces, which put the support team's own
 * replies on the left of their own inbox and read as someone else talking.
 *
 * The name sits OUTSIDE the bubble and only on the first message of a run, and
 * the timestamp is a single trailing line inside it. Before, every message
 * carried a name row AND a time row, so "hhh" rendered three rows tall.
 */
function ThreadMessage({
  message,
  showAuthor,
  isSalciSurface,
}: ThreadMessageProps) {
  const when = relativeTime(message.created_at);

  // Status changes and reopens are centred muted single lines, never bubbles.
  // They are punctuation in the conversation, not turns in it.
  if (message.kind === "system" || message.author_side === "system") {
    return (
      <li className="flex justify-center py-1">
        <p className="px-3 text-center text-xs text-ink-500">
          {message.body} <span className="text-ink-400">· {when}</span>
        </p>
      </li>
    );
  }

  const fromReporter = message.author_side === "reporter";

  // Which side is "You" is derived from the SURFACE, not from a user id:
  // `get_support_thread` deliberately does not return `author_id`, so there is
  // nothing to compare against. /support is opened by the reporter, so the
  // reporter column is theirs; /admin/issues is opened by SALCI, so the SALCI
  // column is. Known edge: a super admin who raises a ticket AND replies to it
  // sees their own reply as "SALCI Support", because post_support_message pins
  // a super admin to the salci side. That quirk predates this component.
  const isViewer = fromReporter !== isSalciSurface;
  const name = resolveAuthorName(message, isViewer, isSalciSurface);

  return (
    <li className={cn("flex", isViewer ? "justify-end" : "justify-start")}>
      <div className={cn("flex max-w-[85%] flex-col gap-1", isViewer && "items-end")}>
        {showAuthor && (
          <div className="flex items-center gap-1.5 px-1">
            <span className="text-[11px] font-medium text-ink-500">{name}</span>
            {message.is_internal && (
              <Badge
                variant="outline"
                className="border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-600"
              >
                Internal
              </Badge>
            )}
          </div>
        )}

        {/* Deliberate deviation from the "cards = surface-card frosted-shadow"
            rule: a chat bubble is not a card, and a drop shadow on every turn
            reads as clutter inside a sheet. Both sides carry the same hairline
            border so they have equal visual weight, which they did not before
            (tint with no border on one side, shadowed card on the other). */}
        <div
          className={cn(
            "rounded-2xl border px-3.5 py-2",
            isViewer ? "rounded-br-md" : "rounded-bl-md",
            message.is_internal
              ? "border-amber-500/40 bg-amber-500/10"
              : isViewer
                ? "border-brand-primary/20 bg-brand-primary/10"
                : "border-surface-stroke bg-surface-card",
          )}
        >
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-900">
            {message.body}
          </p>

          {message.attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {message.attachments.map((file) => (
                <li
                  key={file.path}
                  className="flex items-center gap-1.5 text-xs text-ink-500"
                >
                  <Paperclip className="h-3 w-3 shrink-0" />
                  <span className="truncate">{file.name}</span>
                </li>
              ))}
            </ul>
          )}

          <p
            className={cn(
              "mt-1 text-[10px] text-ink-400",
              isViewer ? "text-right" : "text-left",
            )}
          >
            {when}
          </p>
        </div>
      </div>
    </li>
  );
}

/**
 * The conversation on one support ticket, plus the composer.
 *
 * Mounted by BOTH surfaces: /support passes canPostInternal false, the SALCI
 * inbox passes true. Internal rows are stripped server-side for a reporter, so
 * there is no client-side filter here that could be dropped by accident.
 *
 * This component renders as a plain stacked list and does not scroll itself:
 * both callers put it inside a MobileSheet, whose body is the scroll container.
 */
export function SupportThread({
  ticketId,
  canPostInternal,
  className,
  layout = "stacked",
  onRaiseAgain,
}: SupportThreadProps) {
  const { data, isLoading, isError, error, refetch } = useSupportThread(ticketId);
  const markRead = useMarkSupportTicketRead();
  const markReadMutate = markRead.mutate;
  const isChat = layout === "chat";

  // Chat pane: land on the newest message when the thread opens and follow
  // it as replies arrive, the way every messaging app does.
  const paneRef = React.useRef<HTMLDivElement>(null);
  const messageCount = data?.messages.length ?? 0;
  React.useEffect(() => {
    if (!isChat) return;
    const el = paneRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [isChat, ticketId, messageCount]);

  // Once per ticket open, and only after the thread actually loaded: stamping
  // "read" on a request that failed would clear the unread dot on messages the
  // user never saw.
  const markedRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!data || markedRef.current === ticketId) return;
    markedRef.current = ticketId;
    markReadMutate(ticketId);
  }, [data, ticketId, markReadMutate]);

  React.useEffect(() => {
    markedRef.current = null;
  }, [ticketId]);

  if (isLoading) {
    return (
      <div className={cn("space-y-3", isChat && "p-4", className)}>
        <Skeleton className="h-16 w-3/4 rounded-2xl" />
        <Skeleton className="ml-auto h-16 w-3/4 rounded-2xl" />
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
      </div>
    );
  }

  // Error BEFORE empty (§6). A failed read must never render as "no replies
  // yet": that reads as SALCI ignoring the ticket, which is the worst possible
  // lie for this surface to tell.
  //
  // translateError, not error.message (§19). get_support_thread raises friendly
  // text when it rejects access, but a timeout or a connection failure prints
  // raw engine output, and this component is mounted on the reporter surface
  // every role can open, students included.
  if (isError) {
    return (
      <div className={cn(isChat && "p-4", className)}>
        <EmptyState
          icon={<AlertCircle className="h-7 w-7" />}
          title="Couldn't load this conversation"
          description={
            translateError(
              error,
              "Something went wrong fetching the messages. Please try again.",
            ).title
          }
          tone="rose"
          reason="error"
          action={{ label: "Try again", onClick: () => void refetch() }}
        />
      </div>
    );
  }

  const messages = data?.messages ?? [];

  const conversation = (
    <>
      {data?.has_more && (
        <p className="text-center text-xs text-ink-400">
          Showing the latest 50 messages.
        </p>
      )}

      {messages.length === 0 ? (
        /* The copy is keyed off canPostInternal because this component is
           mounted by BOTH sides. "Goes straight to SALCI" is true only for the
           reporter; printing it inside the SALCI inbox told the support team
           they were writing to themselves. */
        <EmptyState
          icon={<MessageSquare className="h-7 w-7" />}
          title="No messages yet"
          description={
            canPostInternal
              ? "Write a reply to reach the reporter, or switch on Internal note to keep it inside SALCI."
              : "Anything you write here goes straight to SALCI."
          }
          size="sm"
        />
      ) : (
        <ul className="space-y-2">
          {messages.map((message, i) => {
            // Group a run of messages from the same author: only the first
            // carries the name. Repeating it on every turn is what made a
            // two-message exchange read as four stacked blocks.
            const prev = i > 0 ? messages[i - 1] : null;
            const showAuthor =
              !prev ||
              prev.kind === "system" ||
              prev.author_side !== message.author_side ||
              prev.author_name !== message.author_name ||
              prev.is_internal !== message.is_internal;

            return (
              <ThreadMessage
                key={message.id}
                message={message}
                showAuthor={showAuthor}
                isSalciSurface={canPostInternal}
              />
            );
          })}
        </ul>
      )}
    </>
  );

  // ticketStatus comes from the header this RPC already returned, so the
  // composer can warn a reporter that replying reopens a finished request.
  // onPosted re-stamps the read marker: the reply the user just sent moved
  // last_message_at, and without this the ticket comes back in the list
  // wearing its own unread dot.
  const composer = (
    <SupportComposer
      ticketId={ticketId}
      canPostInternal={canPostInternal}
      ticketStatus={data?.ticket.status}
      onPosted={() => markReadMutate(ticketId)}
      onRaiseAgain={onRaiseAgain}
      variant={isChat ? "chat" : "form"}
    />
  );

  if (isChat) {
    return (
      <div className={cn("flex h-full min-h-0 flex-col", className)}>
        <div
          ref={paneRef}
          className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-3"
        >
          {conversation}
        </div>
        {/* Pinned above the home indicator; the keyboard pushes the whole
            pane up because the shell resizes the WebView with it. */}
        <div className="shrink-0 border-t border-surface-stroke bg-surface-card px-3 pt-2 pb-[max(env(safe-area-inset-bottom),12px)]">
          {composer}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4", className)}>
      {conversation}
      <div className="border-t border-surface-stroke pt-4">{composer}</div>
    </div>
  );
}
