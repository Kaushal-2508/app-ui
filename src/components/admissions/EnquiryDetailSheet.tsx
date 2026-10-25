import { useEffect, useMemo, useState, type ReactNode } from "react";
import { format } from "date-fns";
import { AlertTriangle, Check, ClipboardList, Loader2, MessageSquare, Pencil, Receipt, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import type { Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { formatIndianMobile } from "@/lib/phone";
import {
  canDrop,
  canEditFacts,
  daysSince,
  formatAnswer,
  formatRupees,
  PAYMENT_MODE_LABEL,
  SOURCE_LABEL,
  STAGE_LABEL,
  type AdmissionStage,
} from "@/lib/admissions";
import {
  useAddAdmissionNote,
  useAdmissionEnquiry,
  useOpenAdmissionDocument,
  useRemoveAdmissionDocumentFile,
  useReopenEnquiry,
  useSetAdmissionDocuments,
  useUploadAdmissionDocument,
  type AdmissionEnquiryDetail,
  type AdmissionSettings,
  type AdmitResult,
} from "@/hooks/admissions";
import { AdmitSheet } from "./AdmitSheet";
import { DocumentChecklist } from "./DocumentChecklist";
import { DropSheet } from "./DropSheet";
import { NewEnquirySheet } from "./NewEnquirySheet";
import { RegisterSheet } from "./RegisterSheet";
import { StageBadge } from "./parts";
import { PANEL_EDGE, PANEL_TINT } from "./tokens";

function when(iso: string | null | undefined, withTime = false): string {
  if (!iso) return "";
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return iso;
  return format(at, withTime ? "d MMM yyyy, h:mm a" : "d MMM yyyy");
}

/**
 * A block of the record with its own identity (Naman, 2026-10-12: "make it
 * more distinguished", then "more professional, currently looking a bit
 * childish", then "highlight the boxes more"): a card with a 2px top edge
 * in its tone and a deeper shadow, a faintly tinted header row with a small
 * icon square and the title, an optional action, the body.
 */
function Panel({
  title,
  tone,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  tone: Tone;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const edge = PANEL_EDGE[tone];
  return (
    <section className={cn("overflow-hidden rounded-xl border border-surface-stroke border-t-2 bg-[hsl(var(--surface-card))] shadow-card-lg", edge.top, className)} data-panel={title}>
      <header className={cn("flex items-center gap-2.5 border-b border-surface-stroke px-4 py-2.5", edge.head)}>
        <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md [&>svg]:h-4 [&>svg]:w-4", PANEL_TINT[tone])} aria-hidden="true" data-panel-icon="">
          {icon}
        </span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{title}</h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** One line of a record: a muted label, the value in a readable weight. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 py-2">
      <dt className="text-xs text-ink-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-ink-900">{children}</dd>
    </div>
  );
}

const STEPS: AdmissionStage[] = ["enquiry", "registered", "admitted"];

/** Where the enquiry stands: the three steps, the reached ones filled. */
function Stepper({ stage }: { stage: AdmissionStage }) {
  const dropped = stage === "dropped";
  const reached = dropped ? -1 : STEPS.indexOf(stage);
  return (
    <ol className="flex items-center" aria-label="Stage">
      {STEPS.map((s, i) => {
        const done = i < reached;
        const current = i === reached;
        return (
          <li key={s} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ring-1 ring-inset",
                  done && "bg-brand-primary text-white ring-brand-primary",
                  current && "bg-brand-primary/10 text-brand-primary ring-brand-primary",
                  !done && !current && "bg-[hsl(var(--surface-card))] text-ink-500 ring-surface-stroke",
                )}
                aria-current={current ? "step" : undefined}
              >
                {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : i + 1}
              </span>
              <span className={cn("text-xs", current ? "font-semibold text-ink-900" : done ? "text-ink-700" : "text-ink-500")}>{STAGE_LABEL[s]}</span>
            </span>
            {i < STEPS.length - 1 && <span className={cn("mx-3 h-px flex-1", i < reached ? "bg-brand-primary" : "bg-surface-stroke")} aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One enquiry, opened from the register as a centred record (Naman,
 * 2026-10-09: "dont make it a side window, make it in centre and more
 * professional"): the stage stepper across the top, the facts, the fee and
 * the certificates on the left, the activity on the right, and the stage's
 * actions in the footer (the next step as the primary button, Drop beside
 * it while it is still possible).
 */
export function EnquiryDetailSheet({
  enquiryId,
  institutionId,
  settings,
  onClose,
  onOpenStudent,
}: {
  enquiryId: string | null;
  institutionId: string;
  settings: AdmissionSettings | undefined;
  onClose: () => void;
  onOpenStudent?: (profileId: string) => void;
}) {
  const query = useAdmissionEnquiry(enquiryId);
  const e = query.data ?? null;
  const addNote = useAddAdmissionNote();
  const setDocs = useSetAdmissionDocuments();
  const upload = useUploadAdmissionDocument();
  const removeFile = useRemoveAdmissionDocumentFile();
  const openDoc = useOpenAdmissionDocument();
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const reopen = useReopenEnquiry();
  const [registering, setRegistering] = useState(false);
  const [admitting, setAdmitting] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState("");
  const [ticked, setTicked] = useState<string[]>([]);
  // The server's ticks as one string: the local ticks follow it whenever it
  // changes (an admission, an upload or another desk's save), and only then,
  // so a half-made edit survives a background refetch. Seeding once per
  // enquiry left the record on stale ticks after admitting (2026-10-12).
  const serverTicks = useMemo(
    () => (e ? `${e.id}:${e.documents.filter((d) => d.collected).map((d) => d.doc_key).sort().join(",")}` : null),
    [e],
  );
  const [ticksSeeded, setTicksSeeded] = useState<string | null>(null);
  useEffect(() => {
    if (!e || serverTicks === null) return;
    if (ticksSeeded !== serverTicks) {
      setTicked(e.documents.filter((d) => d.collected).map((d) => d.doc_key));
      if (!ticksSeeded || !ticksSeeded.startsWith(`${e.id}:`)) setNote("");
      setTicksSeeded(serverTicks);
    }
  }, [e, serverTicks, ticksSeeded]);
  useEffect(() => {
    if (!enquiryId) {
      setTicksSeeded(null);
      setRegistering(false);
      setAdmitting(false);
      setDropping(false);
      setEditing(false);
    }
  }, [enquiryId]);

  const docsChanged = useMemo(() => {
    if (!e) return false;
    const was = new Set(e.documents.filter((d) => d.collected).map((d) => d.doc_key));
    return was.size !== ticked.length || ticked.some((k) => !was.has(k));
  }, [e, ticked]);
  const docsEditable = e?.stage === "registered" || e?.stage === "admitted";
  const pending = addNote.isPending || setDocs.isPending || reopen.isPending;
  const docFiles = useMemo(
    () => Object.fromEntries((e?.documents ?? []).map((d) => [d.doc_key, d.file_path ? { name: d.file_name ?? "scan" } : null])),
    [e?.documents],
  );
  const uploadDoc = (docKey: string, file: File) => {
    if (!e) return;
    setBusyDoc(docKey);
    upload.mutate(
      { id: e.id, institutionId, docKey, file },
      {
        // A scan in hand is the certificate in hand: tick it locally too, so
        // the Save button does not think the desk unticked it.
        onSuccess: () => setTicked((prev) => (prev.includes(docKey) ? prev : [...prev, docKey])),
        onSettled: () => setBusyDoc(null),
      },
    );
  };
  const removeDoc = (docKey: string) => {
    if (!e) return;
    setBusyDoc(docKey);
    removeFile.mutate({ id: e.id, docKey }, { onSettled: () => setBusyDoc(null) });
  };
  const openDocument = (docKey: string) => {
    const path = e?.documents.find((d) => d.doc_key === docKey)?.file_path;
    if (path) openDoc.mutate(path);
  };

  const stage: AdmissionStage | null = e?.stage ?? null;
  const primary = !e
    ? undefined
    : stage === "enquiry"
      ? { label: "Register", onClick: () => setRegistering(true), disabled: pending }
      : stage === "registered"
        ? { label: "Admit", onClick: () => setAdmitting(true), disabled: pending }
        : stage === "admitted"
          ? e.student_profile_id && onOpenStudent
            ? { label: "Open student", onClick: () => onOpenStudent(e.student_profile_id as string) }
            : { label: "Close", onClick: onClose }
          : { label: "Reopen", onClick: () => reopen.mutate({ id: e.id }), loading: reopen.isPending, disabled: pending };
  const secondary = e && canDrop(e.stage) ? { label: "Drop", onClick: () => setDropping(true), disabled: pending } : { label: "Close", onClick: onClose };

  const onAdmitted = (_r: AdmitResult) => {
    // The slip stays up inside the admit sheet; the record refreshes behind it.
  };

  return (
    <>
      <MobileSheet
        open={!!enquiryId}
        onOpenChange={(open) => !open && onClose()}
        title={e?.student_name ?? "Enquiry"}
        subtitle={e ? `${e.reference_no} · ${e.applying_for_label} · ${e.academic_year_label}` : undefined}
        icon={<UserRound className="h-5 w-5" />}
        placement="center"
        desktopWidth="lg"
        // A record needs room for two columns; the centred panel's default
        // width is for short reading content.
        className="sm:max-w-4xl lg:max-w-6xl"
        primaryAction={primary}
        secondaryAction={secondary}
      >
        {query.isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading" />
          </div>
        ) : query.isError ? (
          <div className="p-4">
            <EmptyState
              size="sm"
              icon={<AlertTriangle className="h-7 w-7" />}
              tone="rose"
              reason="error"
              title="Couldn't load this enquiry"
              description="Check your connection and try again."
              action={{ label: "Retry", onClick: () => query.refetch() }}
            />
          </div>
        ) : e ? (
          <div className="space-y-4 bg-muted/40 p-4" data-enquiry-detail={e.id}>
            {/* Status bar: the stepper, the badge, source and date, Edit. */}
            <div className="rounded-xl border border-surface-stroke bg-[hsl(var(--surface-card))] px-4 py-3 shadow-card-lg">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <StageBadge stage={e.stage} />
                <span className="text-xs text-ink-500">
                  {SOURCE_LABEL[e.source]} · {when(e.created_at)}
                  {e.assigned_to_name ? ` · ${e.assigned_to_name}` : ""}
                </span>
                {canEditFacts(e.stage) && (
                  <Button type="button" variant="outline" size="sm" className="ml-auto h-8 px-2.5 text-xs" onClick={() => setEditing(true)}>
                    <Pencil className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Edit details
                  </Button>
                )}
              </div>
              <div className="mt-3">
                <Stepper stage={e.stage} />
              </div>
              {e.stage === "dropped" && e.dropped_reason && (
                <p className="mt-3 rounded-lg bg-rose-500/[0.06] px-3 py-2 text-sm text-ink-900 ring-1 ring-inset ring-rose-500/20">
                  Dropped: {e.dropped_reason}
                </p>
              )}
              {e.stage === "admitted" && (
                <p className="mt-3 rounded-lg bg-emerald-500/[0.06] px-3 py-2 text-sm text-ink-900 ring-1 ring-inset ring-emerald-500/20">
                  Admitted on {when(e.admitted_on)} with admission number <span className="font-mono font-medium">{e.admission_number}</span>.
                </p>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2 md:items-start lg:grid-cols-3">
              <div className="contents">
                <Panel title="Details" tone="teal" icon={<UserRound />} className="order-1">
                  <dl className="divide-y divide-surface-stroke">
                    <Row label="Parent">{e.parent_name}</Row>
                    <Row label="Mobile">{formatIndianMobile(e.parent_phone)}</Row>
                    {e.parent_email && <Row label="Email">{e.parent_email}</Row>}
                    <Row label="Applying for">
                      {e.applying_for_label} · {e.academic_year_label}
                    </Row>
                    {e.date_of_birth && <Row label="Date of birth">{when(e.date_of_birth)}</Row>}
                    {e.previous_school && <Row label="Previous school">{e.previous_school}</Row>}
                    {(settings?.form_schema ?? [])
                      .filter((q) => !!e.form?.custom?.[q.id])
                      .map((q) => (
                        <Row key={q.id} label={q.label}>
                          <span className="whitespace-pre-wrap">{formatAnswer(q, e.form?.custom?.[q.id])}</span>
                        </Row>
                      ))}
                    {e.next_follow_up_on && e.stage !== "admitted" && <Row label="Next follow-up">{when(e.next_follow_up_on)}</Row>}
                    {e.message && (
                      <Row label="Notes at enquiry">
                        <span className="whitespace-pre-wrap">{e.message}</span>
                      </Row>
                    )}
                  </dl>
                  {e.other_enquiries && e.other_enquiries.length > 0 && (
                    <p className="mt-2 text-xs text-ink-500">
                      Also enquired from this number:{" "}
                      {e.other_enquiries.map((o) => `${o.student_name} (${STAGE_LABEL[o.stage].toLowerCase()}, ${when(o.created_at)})`).join(", ")}
                    </p>
                  )}
                </Panel>

                {(e.stage === "registered" || e.stage === "admitted") && (
                  <Panel
                    title="Certificates"
                    tone="peach"
                    icon={<ClipboardList />}
                    className="order-2 md:order-4 md:col-span-2 lg:col-span-3"
                    action={
                      docsChanged ? (
                        <Button
                          type="button"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          disabled={setDocs.isPending}
                          onClick={() =>
                            setDocs.mutate({ id: e.id, ticks: e.documents.map((d) => ({ doc_key: d.doc_key, collected: ticked.includes(d.doc_key) })) })
                          }
                        >
                          {setDocs.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                          Save certificates
                        </Button>
                      ) : undefined
                    }
                  >
                    <div className="mb-3 flex items-center gap-3">
                      <Progress value={e.documents.length ? (ticked.length / e.documents.length) * 100 : 0} className="h-1 flex-1 bg-muted" aria-hidden="true" />
                    </div>
                    <DocumentChecklist
                      items={e.documents}
                      value={ticked}
                      onChange={setTicked}
                      disabled={!docsEditable || setDocs.isPending}
                      dense
                      files={docFiles}
                      onUpload={uploadDoc}
                      onOpen={openDocument}
                      onRemoveFile={removeDoc}
                      busyKey={busyDoc}
                    />
                  </Panel>
                )}
              </div>

              <div className="contents">
                <Panel title="Registration fee" tone="mint" icon={<Receipt />} className="order-3 md:order-2">
                  {e.registration ? (
                    <>
                      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <span className="text-[22px] font-semibold tabular-nums text-ink-900">{formatRupees(e.registration.fee_rupees)}</span>
                        <span className="text-xs text-ink-500">Paid on {when(e.registration.paid_on)}</span>
                      </div>
                      <dl className="divide-y divide-surface-stroke border-t border-surface-stroke">
                        <Row label="Paid by">{PAYMENT_MODE_LABEL[e.registration.payment_mode]}</Row>
                        <Row label="Receipt">{e.registration.receipt_no}</Row>
                      </dl>
                    </>
                  ) : (
                    <p className="text-sm text-ink-600">Not paid yet. Register once the parent pays it.</p>
                  )}
                  {e.registration && (
                    <p className="sr-only">
                      {formatRupees(e.registration.fee_rupees)} by {PAYMENT_MODE_LABEL[e.registration.payment_mode]}, receipt {e.registration.receipt_no}
                    </p>
                  )}
                  {e.stage === "registered" && (
                    <p className="mt-2 text-xs text-ink-500">Registered {daysSince(e.stage_changed_at) ?? 0} days ago, waiting for admission.</p>
                  )}
                </Panel>

              <Panel title="Activity" tone="violet" icon={<MessageSquare />} className="order-4 md:order-3 md:col-span-2 lg:col-span-1">
                <div className="space-y-2">
                  <Textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={2} placeholder="Called the parent, they will come on Monday…" aria-label="New note" />
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!note.trim() || addNote.isPending}
                      onClick={() => addNote.mutate({ id: e.id, body: note }, { onSuccess: () => setNote("") })}
                    >
                      {addNote.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      Add note
                    </Button>
                  </div>
                </div>
                {e.notes.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-500">No notes yet.</p>
                ) : (
                  <ol className="mt-4 space-y-0">
                    {e.notes.map((n, i) => (
                      <li key={n.id} className="relative pl-5 pb-4 last:pb-0">
                        {/* The rail: a dot per entry, a line to the next one. */}
                        <span className={cn("absolute left-0 top-1.5 h-2 w-2 rounded-full ring-2 ring-[hsl(var(--surface-card))]", n.kind === "stage" ? "bg-brand-primary" : "bg-ink-400")} aria-hidden="true" />
                        {i < e.notes.length - 1 && <span className="absolute left-[3px] top-4 h-[calc(100%-0.5rem)] w-px bg-surface-stroke" aria-hidden="true" />}
                        <p className={cn("text-sm", n.kind === "stage" ? "font-medium text-ink-900" : "text-ink-900")}>{n.body}</p>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {when(n.created_at, true)}
                          {n.created_by_name ? ` · ${n.created_by_name}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
              </div>
            </div>
          </div>
        ) : null}
      </MobileSheet>

      <RegisterSheet enquiry={registering ? e : null} settings={settings} onClose={() => setRegistering(false)} />
      <AdmitSheet
        enquiry={admitting ? e : null}
        institutionId={institutionId}
        settings={settings}
        onClose={() => setAdmitting(false)}
        onAdmitted={onAdmitted}
      />
      <DropSheet enquiry={dropping ? e : null} onClose={() => setDropping(false)} />
      {e && <NewEnquirySheet open={editing} onOpenChange={setEditing} institutionId={institutionId} enquiry={e as AdmissionEnquiryDetail} questions={settings?.form_schema ?? []} />}
    </>
  );
}
