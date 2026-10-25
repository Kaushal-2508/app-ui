import * as React from "react";
import { CheckCircle2 } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets";
import type { IssueStatus } from "@/hooks/useReportedIssues";

export interface ClosureNoteSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The status the ticket is about to take: resolved or closed. */
  target: Extract<IssueStatus, "resolved" | "closed">;
  subject: string;
  loading?: boolean;
  onConfirm: (note: string) => void;
}

export const CLOSURE_NOTE_PLACEHOLDER =
  "Say what was wrong and what you changed. The reporter reads this.";

/**
 * The closure note, as a sheet: a ticket dropped on Resolved or Closed from the
 * board is offered a sentence saying what changed. The same field sits inline in
 * IssueDetailSheet and on the /tasks resolve dialogs, so every path to a closure
 * asks the same question. The note travels as `p_note` on
 * set_support_ticket_status and is filed as a reporter-visible message by the RPC.
 *
 * The note is OPTIONAL and the button is never disabled (2026-09-22). See
 * src/lib/supportSop.ts for what the old 20-character gate broke.
 */
export function ClosureNoteSheet({
  open,
  onOpenChange,
  target,
  subject,
  loading = false,
  onConfirm,
}: ClosureNoteSheetProps) {
  const [note, setNote] = React.useState("");

  React.useEffect(() => {
    if (open) setNote("");
  }, [open, subject]);

  const verb = target === "resolved" ? "Resolve" : "Close";

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      placement="center"
      icon={<CheckCircle2 className="h-4 w-4" />}
      title={`${verb} this request`}
      subtitle={subject}
      primaryAction={{
        label: verb,
        onClick: () => onConfirm(note.trim()),
        loading,
      }}
      secondaryAction={{ label: "Not yet", onClick: () => onOpenChange(false) }}
    >
      <form
        className="grid gap-2"
        data-dirty={note.trim() ? "true" : undefined}
        onSubmit={(e) => e.preventDefault()}
      >
        <Label htmlFor="closure-note">What changed (optional)</Label>
        <Textarea
          id="closure-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={4}
          placeholder={CLOSURE_NOTE_PLACEHOLDER}
          className="resize-none"
        />
        <p className="text-xs text-ink-500">
          Sent to the reporter with the status change. Diagnosis and blame belong in an internal
          note, not here.
        </p>
      </form>
    </MobileSheet>
  );
}
