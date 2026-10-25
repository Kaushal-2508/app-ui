import { format, parseISO } from "date-fns";
import { CalendarClock, Hash, Receipt } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { formatIndianMobile } from "@/lib/phone";
import { PAYMENT_MODE_LABEL, SOURCE_LABEL, daysSince, formatRupees } from "@/lib/admissions";
import type { AdmissionEnquiryRow } from "@/hooks/admissions";
import { StageBadge } from "./parts";

/** The desktop columns; the phone stacks the same facts. The stage column
 *  is a fixed width: every row is its own grid, and an `auto` last track
 *  would shift the other columns by the width of that row's badge. */
export const ROW_GRID = "lg:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1.6fr)_minmax(0,2fr)_7.5rem]";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return format(parseISO(iso), "d MMM yyyy");
  } catch {
    return iso;
  }
}

function ago(iso: string, now: Date): string {
  const days = daysSince(iso, now) ?? 0;
  return days === 0 ? "today" : `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** The column headers of the register, desktop only. */
export function EnquiryRowHeader() {
  return (
    <div
      className={cn("hidden border-b border-surface-stroke bg-muted/40 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-ink-500 lg:grid lg:gap-x-4", ROW_GRID)}
      aria-hidden="true"
    >
      <span>Student</span>
      <span>Applying for</span>
      <span>Parent</span>
      <span>Progress</span>
      <span className="text-right">Stage</span>
    </div>
  );
}

/**
 * One enquiry in the register (Naman, 2026-10-09: "more professional and
 * detailed"): who, for which class, which parent, and where it stands, with
 * the facts of its stage (days waiting, follow-up, fee paid, certificates,
 * admission number). One button, so the keyboard and screen readers get one
 * stop per row.
 */
export function EnquiryRow({ r, now, today, onOpen }: { r: AdmissionEnquiryRow; now: Date; today: string; onOpen: () => void }) {
  const followUpDue = r.stage === "enquiry" && !!r.next_follow_up_on && r.next_follow_up_on <= today;
  const docs = r.documents_total > 0 ? `${r.documents_collected} of ${r.documents_total} certificates` : null;

  const progress = (
    <div className="min-w-0 space-y-1 text-xs text-ink-600">
      {r.stage === "enquiry" && (
        <>
          <p className="truncate">Enquired {ago(r.created_at, now)}</p>
          {r.next_follow_up_on && (
            <p className={cn("flex items-center gap-1 truncate", followUpDue ? "font-medium text-amber-700 dark:text-amber-300" : "")}>
              <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Follow-up {fmtDate(r.next_follow_up_on)}
            </p>
          )}
        </>
      )}
      {r.stage === "registered" && (
        <>
          <p className="truncate">
            Registered {ago(r.stage_changed_at, now)}
            {r.registration && (
              <>
                {" · "}
                <Receipt className="mb-0.5 inline h-3.5 w-3.5 text-ink-500" aria-hidden="true" />{" "}
                {formatRupees(r.registration.fee_rupees)} by {PAYMENT_MODE_LABEL[r.registration.payment_mode]}
              </>
            )}
          </p>
          {docs && (
            <div className="flex max-w-xs items-center gap-2">
              <Progress value={(r.documents_collected / r.documents_total) * 100} className="h-1 flex-1 bg-muted" aria-label={docs} />
              <span className="shrink-0 tabular-nums">{docs}</span>
            </div>
          )}
        </>
      )}
      {r.stage === "admitted" && (
        <>
          <p className="flex items-center gap-1 truncate">
            <Hash className="h-3.5 w-3.5 shrink-0 text-ink-500" aria-hidden="true" />
            <span className="font-mono font-medium text-ink-900">{r.admission_number}</span>
            {r.admitted_on && <span>· admitted {fmtDate(r.admitted_on)}</span>}
          </p>
          {docs && <p className="truncate">{docs}</p>}
        </>
      )}
      {r.stage === "dropped" && (
        <p className="truncate">
          Dropped {ago(r.stage_changed_at, now)}
          {r.dropped_reason ? `: ${r.dropped_reason}` : ""}
        </p>
      )}
    </div>
  );

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "grid w-full gap-x-4 gap-y-2 px-4 py-2.5 text-left transition-colors duration-200 hover:bg-muted/40 focus-visible:outline-none focus-visible:bg-muted/60 lg:items-start",
          ROW_GRID,
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold text-ink-700">
            {initials(r.student_name) || "?"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-ink-900">
              <span className="truncate">{r.student_name}</span>
              {followUpDue && (
                <Badge variant="secondary" className="rounded-md bg-amber-500/10 px-1.5 text-[10px] font-medium text-amber-800 ring-1 ring-inset ring-amber-500/30 hover:bg-amber-500/10 dark:text-amber-200">
                  Follow-up due
                </Badge>
              )}
            </p>
            <p className="text-xs text-ink-500 lg:truncate">
              <span className="font-mono">{r.reference_no}</span> · {SOURCE_LABEL[r.source]} · {fmtDate(r.created_at)}
            </p>
            {/* The phone's summary of the columns beside; it wraps rather than cuts. */}
            <p className="mt-1 text-xs text-ink-600 lg:hidden">
              {r.applying_for_label} · {r.academic_year_label} · {r.parent_name}, {formatIndianMobile(r.parent_phone)}
            </p>
          </div>
          <span className="shrink-0 lg:hidden">
            <StageBadge stage={r.stage} />
          </span>
        </div>

        <div className="hidden min-w-0 lg:block lg:pt-1.5">
          <p className="truncate text-sm text-ink-900">
            {r.applying_for_label} <span className="text-ink-500">· {r.academic_year_label}</span>
          </p>
          {r.date_of_birth && <p className="truncate text-xs text-ink-500">Born {fmtDate(r.date_of_birth)}</p>}
        </div>

        <div className="hidden min-w-0 lg:block lg:pt-1.5">
          <p className="truncate text-sm text-ink-900">{r.parent_name}</p>
          <p className="truncate text-xs text-ink-500">
            {formatIndianMobile(r.parent_phone)}
            {r.parent_email ? ` · ${r.parent_email}` : ""}
          </p>
        </div>

        <div className="pl-11 lg:pl-0 lg:pt-1.5">{progress}</div>

        <span className="hidden lg:flex lg:justify-end lg:pt-1">
          <StageBadge stage={r.stage} />
        </span>
      </button>
    </li>
  );
}
