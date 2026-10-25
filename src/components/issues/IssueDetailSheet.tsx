import * as React from "react";
import { format } from "date-fns";
import { ExternalLink, LifeBuoy, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets";
import { cn } from "@/lib/utils";
import { SupportThread } from "@/components/issues/SupportThread";
import { CLOSURE_NOTE_PLACEHOLDER } from "@/components/issues/ClosureNoteSheet";
import {
  SUPPORT_PRIORITIES,
  SUPPORT_PRIORITY_LABEL,
  UNTRIAGED_LABEL,
  isSupportPriority,
} from "@/lib/supportSop";
import {
  escalationLabel,
  normaliseTaskUrl,
  rememberEscalationName,
  rememberedEscalationNames,
} from "@/lib/supportEscalation";
import { useSetEscalation, useSupportEscalations } from "@/hooks/useSupportEscalations";
import { useSalciStaff, useSetTicketTriage, useSupportSopReady } from "@/hooks/useSupportSop";
import { SUPPORT_URGENCIES } from "@/hooks/useSupportRequest";
import {
  ISSUE_STATUSES,
  ISSUE_STATUS_LABELS,
  useSetIssueStatus,
  type IssueStatus,
  type ReportedIssue,
} from "@/hooks/useReportedIssues";

export interface IssueDetailSheetProps {
  issue: ReportedIssue | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const STATUS_TONES: Record<string, string> = {
  open: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  in_progress: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  resolved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
  closed: "bg-ink-400/10 text-ink-600 border-ink-400/30",
};

/** Sentinels: a select cannot hold an empty string value. */
const NOBODY = "__nobody";
const ADD_NAME = "__add";

/** An unsaved edit of the escalation fields, or null while they show what is stored. */
type EscalationDraft = { name: string; link: string; adding: boolean } | null;

/**
 * The Status control is the operative control of this sheet, so it is painted
 * as one. The shared `outline` Button is `bg-background` (98% white) inside a
 * `surface-card` (100% white) sheet with a `--border` hairline at 91% grey: a
 * two percent fill difference, which read as a disabled field and hid the one
 * thing an operator comes here to change (Tushar, 2026-09-22).
 *
 * Brand tint, not a status tint: tinting by the selected status would make the
 * control weakest exactly on `closed`, whose tone is deliberately the muted
 * one. The saved status still reads in tone from the header Badge above.
 *
 * The border does the work, because alpha composites over whatever is behind:
 * measured separation from the card surface goes 70 -> 245 in light and
 * 49 -> 143 in dark. The fill carries a heavier tint in dark ONLY because
 * `bg-background` there is a well DARKER than the card, so a light wash would
 * have traded 58 points of fill separation for 17; at 0.16 it keeps 39.
 */
const STATUS_CONTROL_CLASS =
  "border-brand-primary/60 bg-brand-primary/[0.07] dark:bg-brand-primary/[0.16] " +
  "font-medium text-ink-900 shadow-sm " +
  "hover:border-brand-primary hover:bg-brand-primary/[0.12] dark:hover:bg-brand-primary/[0.24] " +
  "hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-brand-primary/40";

/**
 * `reported_issues.priority` is written by `create_support_task` from the
 * urgency the reporter picked in SupportRequestSheet, so it uses THAT
 * vocabulary (1 Low, 2 Medium, 3 High). The tasks module reads its own
 * `tasks.priority` with the opposite convention; do not borrow its labels.
 */
function urgencyLabel(priority: number | null): string {
  if (priority === null || priority === undefined) return "N/A";
  return (
    SUPPORT_URGENCIES.find((u) => u.value === String(priority))?.label ??
    String(priority)
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="mt-0.5 truncate text-sm text-ink-700">{value}</p>
    </div>
  );
}

export function IssueDetailSheet({ issue, open, onOpenChange }: IssueDetailSheetProps) {
  const setStatus = useSetIssueStatus();
  // Priority appears once Tushar's column exists (spec 2026-09-18, Part B): it
  // sorts the whole inbox, so it has to be on the ticket row itself. The
  // escalation mark needs no column and is live now, see useSupportEscalations.
  const { data: sopReady = false } = useSupportSopReady(open);
  const setTriage = useSetTicketTriage();
  const live = issue ? issue.status === "open" || issue.status === "in_progress" : false;
  const staff = useSalciStaff(open && live);

  const escalations = useSupportEscalations(open);
  const mark = issue ? (escalations.data?.marks.get(issue.id) ?? null) : null;
  const setEscalation = useSetEscalation();

  // `null` means "show what is stored"; anything else is an unsaved edit. This
  // is a draft rather than state synced from `mark`, so the fields cannot fight
  // the read that fills them in a moment later.
  const [escalationDraft, setEscalationDraft] = React.useState<EscalationDraft>(null);
  const adding = escalationDraft?.adding ?? false;
  const nameValue = escalationDraft ? escalationDraft.name : (mark?.staffName ?? "");
  const linkValue = escalationDraft
    ? escalationDraft.link
    : (mark?.taskUrl ?? "");
  const linkTaskUrl = normaliseTaskUrl(linkValue);
  const linkUnreadable = linkValue.trim().length > 0 && linkTaskUrl === null;
  const escalationDirty =
    escalationDraft !== null &&
    (nameValue.trim() !== (mark?.staffName ?? "") || linkTaskUrl !== (mark?.taskUrl ?? null));
  // A name on its own is never saved: the ticket is escalated only once the
  // task exists and its link is on the ticket. Clearing needs no link.
  const linkMissing = nameValue.trim() !== "" && linkTaskUrl === null;
  const canSaveEscalation = escalationDirty && !linkMissing && !setEscalation.isPending;

  // The picker is the SALCI team plus every name escalated to before plus a way
  // to type a new one. It cannot be the super admin list alone: in production
  // that is one shared account, and the people tickets are handed to are
  // ordinary users or have no account at all.
  const knownNames = escalations.data?.names;
  // Re-read whenever the sheet opens, so a name added on the previous ticket is
  // already in the list on this one.
  const rememberedNames = React.useMemo(() => (open ? rememberedEscalationNames() : []), [open]);
  const nameOptions = React.useMemo(() => {
    const staffList = staff.data ?? [];
    const seen = new Set(staffList.map((s) => s.name));
    const extra = [nameValue, ...(knownNames ?? []), ...rememberedNames].filter((n) => {
      if (!n || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    return [
      { value: NOBODY, label: "Nobody yet" },
      ...staffList.map((s) => ({ value: s.name, label: s.name, description: s.email ?? undefined })),
      ...extra.map((n) => ({ value: n, label: n })),
      // An action, not another person: brand colour and a plus, so it does not
      // read as a teammate called "Add a name".
      {
        value: ADD_NAME,
        label: "Add a name",
        icon: Plus,
        className: "text-brand-primary font-medium",
      },
    ];
  }, [staff.data, knownNames, rememberedNames, nameValue]);

  const [draftStatus, setDraftStatus] = React.useState<IssueStatus>("open");
  // An optional sentence saying what changed, offered whenever the draft moves
  // the ticket to resolved or closed; sent as `p_note`, which the RPC files as a
  // reporter-visible row. OPTIONAL since 2026-09-22: the old 20-character gate
  // disabled this sheet's primary button with the reason invisible, so a closure
  // could not be saved and nothing on screen said why (see lib/supportSop.ts).
  const [closureNote, setClosureNote] = React.useState("");

  // Reset the draft when a DIFFERENT ticket is opened, keyed on the ticket id.
  //
  // An earlier version compared the draft against issue.status during render
  // and reset whenever they differed, which meant selecting a new status
  // immediately snapped back to the stored one. The dropdown could never be
  // changed, so every save posted the unchanged status.
  const loadedId = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (issue && loadedId.current !== issue.id) {
      loadedId.current = issue.id;
      setDraftStatus((issue.status as IssueStatus) ?? "open");
      setClosureNote("");
      setEscalationDraft(null);
    }
  }, [issue]);

  if (!issue) return null;

  const dirty = draftStatus !== issue.status;
  const closing = dirty && (draftStatus === "resolved" || draftStatus === "closed");

  const handleSave = () => {
    if (!dirty || setStatus.isPending) return;
    // The sheet stays open on success: the status move writes a system row into
    // the thread below, and SALCI usually keeps talking straight after it.
    setStatus.mutate(
      {
        ticketId: issue.id,
        status: draftStatus,
        note: closing && closureNote.trim() ? closureNote.trim() : undefined,
      },
      { onSuccess: () => setClosureNote("") },
    );
  };

  // One write: the person and the task link are saved together, because
  // neither is an escalation on its own.
  const handleSaveEscalation = () => {
    if (!canSaveEscalation) return;

    const name = nameValue.trim();
    if (name === "") {
      if (mark) {
        setEscalation.mutate({ ticketId: issue.id, mark: null }, { onSuccess: () => setEscalationDraft(null) });
      } else {
        setEscalationDraft(null);
      }
      return;
    }

    if (!linkTaskUrl) return;
    rememberEscalationName(name);
    // The id is a bonus, kept only when the name belongs to a SALCI account.
    const person = staff.data?.find((s) => s.name === name);
    setEscalation.mutate(
      {
        ticketId: issue.id,
        mark: {
          staffId: person?.id ?? (mark?.staffName === name ? mark.staffId : null),
          staffName: name,
          taskUrl: linkTaskUrl,
        },
      },
      { onSuccess: () => setEscalationDraft(null) },
    );
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={issue.subject}
      subtitle={`Raised ${format(new Date(issue.created_at), "PPp")}`}
      icon={<LifeBuoy className="h-4 w-4" />}
      placement="center"
      // Wider than the shared max-w-lg default: this is the densest centred
      // sheet in the app, stacking a two-column reporter grid, a status
      // control and a full conversation with its composer. At 512px all of
      // that is squeezed into one narrow column and the inner scrollbar does
      // all the work. cn() runs through twMerge and className is merged last,
      // so this overrides the default without touching the other five
      // centred consumers.
      className="sm:max-w-2xl"
      primaryAction={{
        label: closing ? (draftStatus === "resolved" ? "Resolve" : "Close request") : "Update status",
        onClick: handleSave,
        loading: setStatus.isPending,
        disabled: !dirty,
      }}
      secondaryAction={{ label: "Close", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={STATUS_TONES[issue.status] ?? ""}>
            {ISSUE_STATUS_LABELS[issue.status as IssueStatus] ?? issue.status}
          </Badge>
          {issue.category && (
            <Badge variant="outline" className="border-surface-stroke text-ink-600">
              {issue.category}
            </Badge>
          )}
          <Badge variant="outline" className="border-surface-stroke text-ink-600">
            Urgency: {urgencyLabel(issue.priority)}
          </Badge>
          {sopReady && live && (
            <Badge
              variant="outline"
              className={
                issue.triage_priority
                  ? "border-ink-700 font-semibold text-ink-900"
                  : "border-dashed border-ink-400 text-ink-600"
              }
            >
              {issue.triage_priority ? SUPPORT_PRIORITY_LABEL[issue.triage_priority] : UNTRIAGED_LABEL}
            </Badge>
          )}
          {mark && (
            <Badge
              variant="outline"
              className="border-violet-500/30 bg-violet-500/10 font-medium text-violet-600"
            >
              {escalationLabel(mark)}
            </Badge>
          )}
        </div>

        {/* SOP: the super admin sets the priority (the reporter's urgency above
            is only a hint) and records who is working on the ticket.

            Priority waits on its column (spec 2026-09-18 §4.1, Tushar) because
            it orders the whole inbox, which means it has to be on the ticket
            row itself; it is shown disabled so the place is visible, and
            enables itself once the probe sees the column, with no deploy.
            Escalation needs no column and is live. */}
        {live && (
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Always rendered, disabled until the probe sees the column: it can
                only go from disabled to live, so there is nothing to flash, and
                holding the space stops the escalation block jumping column. */}
            <div className="grid gap-2">
              <Label>Priority</Label>
              <SearchableSelect
                value={sopReady ? (issue.triage_priority ?? "") : ""}
                onValueChange={(value) => {
                  if (!isSupportPriority(value) || value === issue.triage_priority || setTriage.isPending) return;
                  setTriage.mutate({ ticketId: issue.id, priority: value });
                }}
                disabled={!sopReady}
                placeholder={UNTRIAGED_LABEL}
                searchPlaceholder="Search..."
                options={SUPPORT_PRIORITIES.map((p) => ({
                  value: p.value,
                  label: p.label,
                  description: p.definition,
                }))}
              />
              {!sopReady && <p className="text-xs text-ink-500">Switches on with the next update.</p>}
            </div>

            <div className="grid gap-2">
              <Label htmlFor={`escalation-link-${issue.id}`}>Escalated to</Label>
              <SearchableSelect
                value={adding ? ADD_NAME : nameValue || NOBODY}
                onValueChange={(value) => {
                  if (setEscalation.isPending) return;
                  if (value === ADD_NAME) {
                    setEscalationDraft({ name: "", link: "", adding: true });
                    return;
                  }
                  const name = value === NOBODY ? "" : value;
                  // A different person gets a different task, so the link that
                  // belonged to the last one does not follow them.
                  setEscalationDraft({ name, link: name === nameValue ? linkValue : "", adding: false });
                }}
                disabled={escalations.isError}
                placeholder={staff.isLoading ? "Loading" : "Nobody yet"}
                searchPlaceholder="Search or add..."
                options={nameOptions}
              />
              {adding && (
                <Input
                  value={nameValue}
                  onChange={(e) => setEscalationDraft({ name: e.target.value, link: linkValue, adding: true })}
                  // Kept the moment the field is left, not only when the
                  // escalation saves: the task link usually arrives minutes
                  // later, and the name must not have to be typed twice.
                  onBlur={() => rememberEscalationName(nameValue)}
                  placeholder="Their name"
                  aria-label="Name"
                  autoFocus
                />
              )}
              {(adding || nameValue !== "") && (
                <Input
                  id={`escalation-link-${issue.id}`}
                  value={linkValue}
                  onChange={(e) =>
                    setEscalationDraft({ name: nameValue, link: e.target.value, adding })
                  }
                  placeholder="Paste the task link"
                  aria-label="Task link"
                  aria-invalid={linkUnreadable}
                  className={linkUnreadable ? "border-rose-500/60 focus-visible:ring-rose-500/40" : undefined}
                />
              )}
              {/* Only speaks up when something is wrong or the save is held
                  back. Error before empty (CLAUDE.md §6): a failed read must
                  not read as "nobody". */}
              {(escalations.isError || staff.isError || linkUnreadable || linkMissing) && (
                <p className={linkMissing && !linkUnreadable ? "text-xs text-ink-500" : "text-xs text-rose-600"}>
                  {escalations.isError
                    ? "Couldn't check who is working on this."
                    : staff.isError
                      ? "Couldn't load the team."
                      : linkUnreadable
                        ? "That is not a task link."
                        : "Add the task link to escalate."}
                </p>
              )}
              {(escalationDirty || setEscalation.isPending) && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSaveEscalation}
                    disabled={!canSaveEscalation}
                    className="bg-brand-primary text-white hover:bg-brand-primary/90"
                  >
                    {setEscalation.isPending ? "Saving" : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setEscalationDraft(null)}
                    disabled={setEscalation.isPending}
                  >
                    Cancel
                  </Button>
                </div>
              )}
              {mark && !escalationDirty && (
                // A plain anchor, not a router Link: the task usually lives on
                // another SALCI surface (the LMS on salci.sale), so this is a
                // real navigation and opens in its own tab.
                <a
                  href={mark.taskUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open the task
                </a>
              )}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Reporter" value={issue.reporter_name || "Unknown"} />
          <Field label="Email" value={issue.reporter_email || "N/A"} />
          <Field
            label="Role"
            value={
              <span className="capitalize">
                {issue.reporter_role?.replace(/_/g, " ") || "N/A"}
              </span>
            }
          />
          <Field label="School" value={issue.institution_name || "N/A"} />
          <Field
            label="First reply"
            value={
              issue.first_response_at
                ? format(new Date(issue.first_response_at), "PPp")
                : "Not yet"
            }
          />
          <Field
            label="Resolved"
            value={
              issue.resolved_at ? format(new Date(issue.resolved_at), "PPp") : "Not yet"
            }
          />
          {issue.classes_assigned && (
            <div className="col-span-2">
              <Field label="Classes" value={issue.classes_assigned} />
            </div>
          )}
        </div>

        {/* Its own form element, deliberately NOT wrapping the thread: the
            composer below carries its own form, and nesting forms is invalid
            HTML. data-dirty keeps the service worker from reloading the tab
            under an unsaved status change (§17). */}
        <form
          data-dirty={dirty || closureNote.trim() ? "true" : undefined}
          onSubmit={(e) => e.preventDefault()}
          className="grid gap-2"
        >
          {/* No htmlFor: SearchableSelect renders a combobox button, not an
              input with an id, so an htmlFor here would dangle. */}
          <Label>Status</Label>
          <SearchableSelect
            value={draftStatus}
            onValueChange={(value) => setDraftStatus(value as IssueStatus)}
            placeholder="Set a status"
            searchPlaceholder="Search..."
            options={ISSUE_STATUSES.map((s) => ({ value: s, label: ISSUE_STATUS_LABELS[s] }))}
            triggerClassName={cn(STATUS_CONTROL_CLASS, dirty && "ring-2 ring-brand-primary/30")}
          />
          {closing && (
            <div className="grid gap-1.5 pt-1">
              <Label htmlFor={`closure-note-${issue.id}`}>What changed (optional)</Label>
              <Textarea
                id={`closure-note-${issue.id}`}
                value={closureNote}
                onChange={(e) => setClosureNote(e.target.value)}
                rows={3}
                placeholder={CLOSURE_NOTE_PLACEHOLDER}
                className="resize-none"
              />
            </div>
          )}
          {/* Only the closure case needs saying: the note is public, and that
              is the mistake worth preventing. The rest of what used to sit here
              is already on the controls it described. */}
          {closing && (
            <p className="text-xs text-ink-500">
              The reporter reads this note. Diagnosis belongs in an internal note below.
            </p>
          )}
        </form>

        <div className="space-y-2">
          <p className="eyebrow">Conversation</p>
          {/* The single thread component, shared with the reporter's /support
              page. canPostInternal is the only difference between the two
              surfaces, and the RPC omits internal rows from the reporter read
              regardless, so the split is enforced in Postgres, not here.
              The reporter's original description is the thread's first message,
              seeded by create_support_task, so it is not repeated above. */}
          <SupportThread ticketId={issue.id} canPostInternal />
        </div>
      </div>
    </MobileSheet>
  );
}
