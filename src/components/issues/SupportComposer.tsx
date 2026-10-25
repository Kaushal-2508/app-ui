import * as React from "react";
import { RotateCcw, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  usePostSupportMessage,
  type SupportTicket,
} from "@/hooks/useSupportTickets";

export interface SupportComposerProps {
  ticketId: string;
  /** Super admin only. A reporter is rejected server-side if this is forged. */
  canPostInternal: boolean;
  /**
   * The ticket's current status. A finished request does not take replies from
   * the reporter: `post_support_message` reopens the ticket whenever they post
   * on a resolved or closed one, which puts finished work back in the Open tab.
   * The composer is therefore replaced by the panel below, and the reporter
   * carries the problem into a fresh request instead.
   */
  ticketStatus?: SupportTicket["status"];
  /** Fired after a successful post, so the mounting surface can react. */
  onPosted?: () => void;
  /**
   * Opens the new-request form, carrying this ticket's details. Supplied by the
   * reporter's surface only; without it a closed request simply says it is
   * closed.
   */
  onRaiseAgain?: () => void;
  /**
   * "form" (default) is the stacked box with a labelled Send button that the
   * web sheets use. "chat" is the phone messaging row: a one-line field that
   * grows with the text beside a round send button, for the app's
   * full-screen thread where the composer is pinned above the keyboard.
   */
  variant?: "form" | "chat";
}

/**
 * Reply box for a support ticket, shared by /support and /admin/issues.
 *
 * The internal toggle restyles the whole box in amber, not just a label,
 * because a private note typed into the public field is the single most
 * expensive mistake this surface can produce.
 *
 * Errors are NOT handled here on purpose: `usePostSupportMessage` routes its
 * `onError` through `toastError`, so there is one translated message for every
 * caller of the write path (CLAUDE.md §19).
 *
 * Phase 6 (Task 34) edits this file to add the attachment picker: a hidden file
 * input, a pending-file list above the send row, and an upload step at the top
 * of `handleSend` that turns the picked files into `attachments`. The four
 * props above do not change.
 */
export function SupportComposer({
  ticketId,
  canPostInternal,
  ticketStatus,
  onPosted,
  onRaiseAgain,
  variant = "form",
}: SupportComposerProps) {
  const [body, setBody] = React.useState("");
  const [isInternal, setIsInternal] = React.useState(false);
  const post = usePostSupportMessage();
  const isChat = variant === "chat";

  // The chat field starts one line tall and grows with the draft, capped at
  // about five lines so the thread above it stays in view.
  const fieldRef = React.useRef<HTMLTextAreaElement>(null);
  React.useEffect(() => {
    if (!isChat) return;
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [isChat, body]);

  // One idempotency token per draft, regenerated only after a successful post.
  // A retry of a failed send reuses the token, so a message that actually
  // landed before the network died is returned rather than duplicated.
  const tokenRef = React.useRef<string>(crypto.randomUUID());

  React.useEffect(() => {
    setBody("");
    setIsInternal(false);
    tokenRef.current = crypto.randomUUID();
  }, [ticketId]);

  const trimmed = body.trim();
  const busy = post.isPending;
  const canSend = trimmed.length > 0 && !busy;

  // A reporter's reply on a finished request is reopened by the RPC itself, so
  // the reply box is replaced rather than warned about. SALCI's own reply never
  // reopens anything, so their composer is untouched.
  const finished =
    !canPostInternal && (ticketStatus === "resolved" || ticketStatus === "closed");

  if (finished) {
    return (
      <div
        className={cn(
          "rounded-card border border-surface-stroke bg-surface-base/60",
          isChat ? "space-y-2 p-3" : "space-y-3 p-4",
        )}
      >
        <p className="text-sm font-medium text-ink-900">This request is closed.</p>
        <p className="text-xs leading-5 text-ink-500">
          The whole conversation stays here for you to read. If the problem is back, raise it
          again and SALCI will pick it up as a new request.
        </p>
        {onRaiseAgain && (
          <Button
            type="button"
            size="sm"
            onClick={onRaiseAgain}
            className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Raise this again
          </Button>
        )}
      </div>
    );
  }

  const handleSend = () => {
    // Single flight: `busy` gates the double tap, `client_token` gates the
    // retry, and the RPC throttles the caller at 30 messages an hour.
    if (!canSend) return;

    post.mutate(
      {
        ticketId,
        body: trimmed,
        isInternal: canPostInternal && isInternal,
        attachments: [],
        clientToken: tokenRef.current,
      },
      {
        onSuccess: () => {
          setBody("");
          setIsInternal(false);
          tokenRef.current = crypto.randomUUID();
          onPosted?.();
        },
      },
    );
  };

  return (
    <form
      // Service-worker dirty-form contract (§17): while there is unsent text,
      // an update must toast rather than silently reload the page underneath.
      data-dirty={trimmed.length > 0 ? "true" : undefined}
      onSubmit={(e) => {
        e.preventDefault();
        handleSend();
      }}
      className={isChat ? "space-y-2" : "space-y-3"}
    >
      {canPostInternal && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 rounded-card border p-3 transition-colors duration-200",
            isInternal
              ? "border-amber-500/40 bg-amber-500/10"
              : "border-surface-stroke bg-surface-base/60",
          )}
        >
          <div className="min-w-0">
            <Label
              htmlFor={`support-internal-${ticketId}`}
              className="text-sm font-medium text-ink-900"
            >
              Internal note
            </Label>
            <p className="text-xs text-ink-500">
              {isInternal
                ? "Only SALCI can read this. The reporter is not notified."
                : "Off, so your reply goes to the reporter."}
            </p>
          </div>
          <Switch
            id={`support-internal-${ticketId}`}
            checked={isInternal}
            onCheckedChange={setIsInternal}
          />
        </div>
      )}

      {isChat ? (
        <>
          <div className="flex items-end gap-2">
            <Textarea
              ref={fieldRef}
              id={`support-composer-${ticketId}`}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={isInternal ? "Note for SALCI only" : "Message"}
              rows={1}
              disabled={busy}
              aria-label={isInternal ? "Internal note" : "Reply"}
              className={cn(
                "min-h-[40px] flex-1 resize-none overflow-y-auto rounded-2xl border-surface-stroke bg-surface-base px-4 py-2.5 text-[15px] leading-5",
                isInternal && "border-amber-500/50 bg-amber-500/5 focus-visible:ring-amber-500/40",
              )}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!canSend}
              aria-label={busy ? "Sending" : isInternal ? "Save note" : "Send"}
              className="h-10 w-10 shrink-0 rounded-full bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.96]"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </>
      ) : (
        <>
          <Textarea
            id={`support-composer-${ticketId}`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={isInternal ? "Write a note only SALCI can see." : "Write your reply"}
            rows={3}
            disabled={busy}
            aria-label={isInternal ? "Internal note" : "Reply"}
            className={cn(
              "resize-none",
              isInternal && "border-amber-500/50 bg-amber-500/5 focus-visible:ring-amber-500/40",
            )}
          />

          <div className="flex items-center justify-end gap-2">
            <Button
              type="submit"
              disabled={!canSend}
              className="bg-brand-primary text-white hover:bg-brand-primary/90 active:scale-[0.98]"
            >
              <Send className="mr-2 h-4 w-4" />
              {busy ? "Sending" : isInternal ? "Save note" : "Send reply"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
