import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { format } from "date-fns";
import { ArrowUp, ChevronLeft, ChevronRight, Download, Loader2, Mic, Star } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterSheet } from "@/components/shared/nav";
import { MobileSheet } from "@/components/shared/sheets";
import {
  Crumbs,
  LevelTag,
  TradTable,
  V5Card,
  V5CardHead,
  V5Empty,
  V5Error,
  V5Loading,
  tdBase,
  thBase,
  type Crumb,
} from "@/components/command-center/v5/primitives";
import { AudioPlayer } from "./AudioPlayer";
import { MetricInfo } from "./MetricInfo";
import { PTM_METRIC_HELP } from "./metricHelp";
import { toastError } from "@/lib/toast";
import { cn, formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import { formatDuration, type PTMHat } from "@/lib/ptm";
import {
  DEFAULT_FEEDBACK_FILTERS,
  FEEDBACK_PAGE_SIZE,
  buildPTMFeedbackCsv,
  usePTMFeedbackList,
  usePTMFeedbackSummary,
  type PTMFeedbackFilters,
  type PTMFeedbackRow,
  type PTMFeedbackSort,
  type PTMManageableScope,
} from "@/hooks/ptm";

interface Props {
  ptmId: string;
  ptmTitle: string;
  hat: PTMHat;
  /** The hat's wings and classes (ptm_manageable_scope); supplies wing names
   *  and which wing each class sits in. */
  scope: PTMManageableScope | undefined;
  slotBookingEnabled: boolean;
}

type Level = "wings" | "classes" | "students";

const NO_WING = "__no_wing__";
const ANY = "any";

interface ClassNode {
  id: string;
  label: string;
  name: string;
  section: string | null;
  students: number;
  responses: number;
  avg: number | null;
  slots: number;
  booked: number;
  attended: number;
  wingKey: string;
}

interface Totals {
  students: number;
  responses: number;
  avg: number | null;
  slots: number;
  booked: number;
  attended: number;
}

interface WingNode extends Totals {
  key: string;
  name: string;
  classes: ClassNode[];
}

interface Drill {
  wingKey: string | null;
  wingName: string | null;
  classId: string | null;
  classLabel: string | null;
}

const ROOT: Drill = { wingKey: null, wingName: null, classId: null, classLabel: null };

/** A breakdown column: its heading and, for a number, what it counts. */
interface HeadCell {
  label: string;
  help?: string;
}

const SORTS: { value: PTMFeedbackSort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "rating_desc", label: "Highest rating" },
  { value: "rating_asc", label: "Lowest rating" },
];

/** Sum the rows of a level. The average is weighted by responses, never a
 *  mean of class means, so a class of 40 counts more than a class of 4. */
function rollUp(classes: ClassNode[]): Totals {
  let students = 0;
  let responses = 0;
  let slots = 0;
  let booked = 0;
  let attended = 0;
  let ratingSum = 0;
  let rated = 0;
  for (const c of classes) {
    students += c.students;
    responses += c.responses;
    slots += c.slots;
    booked += c.booked;
    attended += c.attended;
    if (c.avg !== null && c.responses > 0) {
      ratingSum += c.avg * c.responses;
      rated += c.responses;
    }
  }
  return { students, responses, slots, booked, attended, avg: rated > 0 ? ratingSum / rated : null };
}

function rate(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "N/A";
}

function rating(value: number | null): string {
  return value === null ? "N/A" : value.toFixed(1);
}

function countFilters(f: PTMFeedbackFilters): number {
  return (f.rating !== null ? 1 : 0) + (f.hasAudio !== null ? 1 : 0) + (f.hasText !== null ? 1 : 0) + (f.sort !== "newest" ? 1 : 0);
}

function Stars({ value, size = "h-3.5 w-3.5" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(size, n <= value ? "fill-brand-accent text-brand-accent" : "text-ink-400")}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

/**
 * Feedback for one PTM as a drill-down, the same shape as the Command
 * Center's School performance tree (Dash5Tree): wings, then a wing's classes,
 * then a class's families and what they said. Numbers come from
 * ptm_feedback_summary (already scoped to the hat); the family rows from
 * ptm_feedback_list for that one class, paged on the server.
 */
export function PTMFeedbackTree({ ptmId, ptmTitle, hat, scope, slotBookingEnabled }: Props) {
  const summary = usePTMFeedbackSummary(ptmId, hat);
  const [drill, setDrill] = useState<Drill>(ROOT);
  const [applied, setApplied] = useState<PTMFeedbackFilters>(DEFAULT_FEEDBACK_FILTERS);
  const [draft, setDraft] = useState<PTMFeedbackFilters>(DEFAULT_FEEDBACK_FILTERS);
  const [page, setPage] = useState(0);
  const [openRow, setOpenRow] = useState<PTMFeedbackRow | null>(null);
  const [exporting, setExporting] = useState(false);

  const { classes, wings, showWings, rootName } = useMemo(() => {
    const s = summary.data;
    const wingOf = new Map((scope?.classes ?? []).map((c) => [c.id, c.wing_id]));
    const wingName = new Map((scope?.wings ?? []).map((w) => [w.id, w.name]));
    const bookingOf = new Map((s?.bookings.per_class ?? []).map((b) => [b.class_id, b]));

    const nodes: ClassNode[] = sortClassRows(
      (s?.per_class ?? []).map((c) => {
        const b = bookingOf.get(c.class_id);
        const wing = wingOf.get(c.class_id);
        return {
          id: c.class_id,
          label: formatClassName(c.class_name, c.class_section),
          name: c.class_name,
          section: c.class_section,
          students: c.students,
          responses: c.responses,
          avg: c.avg_rating,
          slots: b?.total_slots ?? 0,
          booked: b?.booked ?? 0,
          attended: b?.attended ?? 0,
          wingKey: wing && wingName.has(wing) ? wing : NO_WING,
        };
      }),
      (c) => c.name,
      (c) => c.section,
    );

    // Wings in the order the school set them (the scope RPC returns them in
    // display order); classes outside every wing go last in their own group.
    const order = [...(scope?.wings ?? []).map((w) => w.id), NO_WING];
    const groups: WingNode[] = order
      .map((key) => {
        const members = nodes.filter((n) => n.wingKey === key);
        return {
          key,
          name: key === NO_WING ? "Not in a wing" : wingName.get(key) ?? "Wing",
          classes: members,
          ...rollUp(members),
        };
      })
      .filter((g) => g.classes.length > 0);

    const single = groups.length === 1 ? groups[0] : null;
    return {
      classes: nodes,
      wings: groups,
      showWings: groups.length > 1,
      rootName: single && single.key !== NO_WING ? single.name : hat === "teacher" ? "Your classes" : "All classes",
    };
  }, [summary.data, scope, hat]);

  // A one-class PTM opens straight onto its families; a one-wing scope (a
  // coordinator, or a school with a single wing) starts inside the wing.
  const onlyClass = classes.length === 1 ? classes[0] : null;
  const classId = drill.classId ?? onlyClass?.id ?? null;
  const level: Level = classId ? "students" : drill.wingKey || !showWings ? "classes" : "wings";

  const currentWing = drill.wingKey ? wings.find((w) => w.key === drill.wingKey) ?? null : null;
  const levelClasses = currentWing ? currentWing.classes : classes;
  const currentClass = classId ? classes.find((c) => c.id === classId) ?? null : null;

  const filters = useMemo<PTMFeedbackFilters>(() => ({ ...applied, classId }), [applied, classId]);
  const list = usePTMFeedbackList(ptmId, hat, filters, page, level === "students");
  const listRows = list.data?.rows ?? [];
  const listTotal = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(listTotal / FEEDBACK_PAGE_SIZE));
  const activeFilters = countFilters(applied);

  const resetStudents = () => {
    setApplied(DEFAULT_FEEDBACK_FILTERS);
    setDraft(DEFAULT_FEEDBACK_FILTERS);
    setPage(0);
  };
  const openWing = (w: WingNode) => {
    resetStudents();
    setDrill({ wingKey: w.key, wingName: w.name, classId: null, classLabel: null });
  };
  const openClass = (c: ClassNode) => {
    resetStudents();
    setDrill((d) => ({ ...d, classId: c.id, classLabel: c.label }));
  };
  const toRoot = () => {
    resetStudents();
    setDrill(ROOT);
  };
  const toWing = () => {
    resetStudents();
    setDrill((d) => ({ ...d, classId: null, classLabel: null }));
  };

  const canGoUp = level !== "wings" && !(level === "classes" && !showWings) && !(level === "students" && onlyClass);
  const up = () => {
    if (level === "students") {
      if (drill.wingKey || !showWings) toWing();
      else toRoot();
    } else {
      toRoot();
    }
  };

  const crumbs: Crumb[] = (() => {
    const rootLabel = showWings ? "All wings" : rootName;
    const out: Crumb[] = [{ label: rootLabel, onClick: level === "wings" || (!showWings && level === "classes") ? undefined : toRoot }];
    if (showWings && drill.wingKey) {
      out.push({ label: drill.wingName ?? "Wing", onClick: level === "students" ? toWing : undefined });
    }
    if (level === "students" && currentClass && !onlyClass) out.push({ label: currentClass.label });
    if (level === "students" && onlyClass) out[0] = { label: onlyClass.label };
    return out;
  })();

  const exportCsv = async () => {
    setExporting(true);
    try {
      const target = level === "students" ? filters : { ...DEFAULT_FEEDBACK_FILTERS };
      const { csv, rowCount, truncated } = await buildPTMFeedbackCsv(ptmId, hat, target);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const scopeName = level === "students" && currentClass ? `-${currentClass.label}` : "";
      a.href = url;
      a.download = `${`${ptmTitle}${scopeName}`.replace(/[^\w\d-]+/g, "-").toLowerCase() || "ptm"}-feedback.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        truncated
          ? `Exported the first ${rowCount} rows. Narrow the filters for the rest.`
          : `Exported ${rowCount} ${rowCount === 1 ? "row" : "rows"}.`,
      );
    } catch (e) {
      toastError(e, { fallback: "Couldn't export the feedback.", context: "exportPTMFeedback" });
    } finally {
      setExporting(false);
    }
  };

  const s = summary.data;
  const overall: Totals | null = s
    ? {
        students: s.students_in_scope,
        responses: s.responses,
        avg: s.avg_rating,
        slots: s.bookings.total_slots,
        booked: s.bookings.booked,
        attended: s.bookings.attended,
      }
    : null;
  const levelTotals: Totals | null =
    level === "classes" ? (currentWing ? currentWing : overall) : level === "wings" ? overall : null;

  const levelTag =
    level === "wings"
      ? `${wings.length} ${wings.length === 1 ? "wing" : "wings"}`
      : level === "classes"
        ? `${levelClasses.length} ${levelClasses.length === 1 ? "class" : "classes"}`
        : `${listTotal} ${listTotal === 1 ? "response" : "responses"}`;

  const subtitle =
    level === "wings"
      ? "Click a wing to open its classes, then a class to read what its families said. Every total is the sum of the rows above it."
      : level === "classes"
        ? `${levelTotals ? `${levelTotals.students} students across ${levelClasses.length} ${levelClasses.length === 1 ? "class" : "classes"}. ` : ""}Click a class to read what its families said.`
        : currentClass
          ? `${currentClass.responses} of ${currentClass.students} families responded · average ${rating(currentClass.avg)} · ${Math.max(0, currentClass.students - currentClass.responses)} yet to respond. Click a family to read it in full.`
          : "";

  // No class-teacher column: most schools have not named class teachers, so
  // it read "Not assigned" on every row (Naman, 2026-09-29).
  const bookingHeads: HeadCell[] = slotBookingEnabled
    ? [
        { label: "Slots booked", help: PTM_METRIC_HELP.slotsBooked },
        { label: "Attended", help: PTM_METRIC_HELP.attended },
      ]
    : [];
  const head: HeadCell[] = [
    { label: level === "wings" ? "Wing" : "Class" },
    ...(level === "wings" ? [{ label: "Classes", help: PTM_METRIC_HELP.classes }] : []),
    { label: "Students", help: PTM_METRIC_HELP.students },
    { label: "Responded", help: PTM_METRIC_HELP.responded },
    { label: "Response rate", help: PTM_METRIC_HELP.responseRate },
    { label: "Average rating", help: PTM_METRIC_HELP.averageRating },
    ...bookingHeads,
  ];

  const rowProps = (onOpen: () => void, i: number) => ({
    onClick: onOpen,
    role: "button" as const,
    tabIndex: 0,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onOpen();
      }
    },
    className: cn(
      "cursor-pointer",
      i % 2 === 1 && "bg-surface-stroke/25",
      "hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary",
    ),
  });

  const nameCell = (name: string, sub: string | null) => (
    <td className={tdBase}>
      <div className="flex items-center gap-2 font-bold tracking-[-0.01em] text-ink-900">
        <span className="text-[11px] text-ink-400" aria-hidden>
          ▸
        </span>
        <span className="truncate">{name}</span>
      </div>
      {sub && <div className="mt-px truncate pl-[19px] text-[11.5px] font-medium text-ink-500">{sub}</div>}
    </td>
  );

  const numberCells = (t: Totals) => (
    <>
      <td className={cn(tdBase, "text-right tabular-nums")}>{t.students}</td>
      <td className={cn(tdBase, "text-right tabular-nums")}>{t.responses}</td>
      <td className={cn(tdBase, "text-right tabular-nums")}>{rate(t.responses, t.students)}</td>
      <td className={cn(tdBase, "text-right tabular-nums font-bold")}>
        {t.avg === null ? <span className="font-medium text-ink-400">No feedback yet</span> : rating(t.avg)}
      </td>
      {slotBookingEnabled && (
        <>
          <td className={cn(tdBase, "text-right tabular-nums")}>
            {t.booked} / {t.slots}
          </td>
          <td className={cn(tdBase, "text-right tabular-nums")}>{t.attended}</td>
        </>
      )}
    </>
  );

  const footCell = cn(tdBase, "border-t-2 border-t-ink-400");

  return (
    <V5Card>
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[280px]">
          <Crumbs items={crumbs} />
          <p className="mt-1.5 text-xs font-medium text-ink-500">{subtitle}</p>
        </div>
        {s && <LevelTag>{levelTag}</LevelTag>}
        {canGoUp && (
          <Button variant="outline" size="sm" onClick={up}>
            <ArrowUp aria-hidden="true" />
            Up one level
          </Button>
        )}
        {s && s.responses > 0 && (
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={exporting}>
            {exporting ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Download aria-hidden="true" />}
            {level === "students" ? "Export class" : "Export CSV"}
          </Button>
        )}
      </V5CardHead>

      <div className={cn("px-4 sm:px-[18px]", level !== "students" && "pb-3")}>
        {summary.isLoading ? (
          <V5Loading label="Loading the feedback breakdown" />
        ) : summary.isError || !s ? (
          <V5Error label="Couldn't load the feedback breakdown." onRetry={() => void summary.refetch()} />
        ) : classes.length === 0 ? (
          <V5Empty
            title="None of your classes are in this PTM"
            sub="The breakdown shows the classes you are responsible for."
          />
        ) : level === "students" ? (
          <StudentLevel
            classLabel={currentClass?.label ?? ""}
            rows={listRows}
            total={listTotal}
            page={page}
            pageCount={pageCount}
            isLoading={list.isLoading}
            isError={list.isError}
            isFetching={list.isFetching}
            onRetry={() => void list.refetch()}
            onPage={setPage}
            onOpen={setOpenRow}
            filterSlot={
              <FilterSheet
                activeCount={activeFilters}
                onApply={() => {
                  setApplied(draft);
                  setPage(0);
                }}
                onReset={resetStudents}
              >
                <FeedbackFilters draft={draft} onChange={setDraft} />
              </FilterSheet>
            }
            activeFilters={activeFilters}
            onClearFilters={resetStudents}
          />
        ) : (
          <TradTable>
            <thead>
              <tr>
                {head.map((h, i) => (
                  <th key={h.label} className={cn(thBase, i > 0 && "text-right")}>
                    {h.help ? (
                      <span className="inline-flex items-center gap-1">
                        {h.label}
                        <MetricInfo label={h.label}>{h.help}</MetricInfo>
                      </span>
                    ) : (
                      h.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {level === "wings"
                ? wings.map((w, i) => (
                    <tr key={w.key} {...rowProps(() => openWing(w), i)}>
                      {nameCell(w.name, `${Math.max(0, w.students - w.responses)} yet to respond`)}
                      <td className={cn(tdBase, "text-right tabular-nums")}>{w.classes.length}</td>
                      {numberCells(w)}
                    </tr>
                  ))
                : levelClasses.map((c, i) => (
                    <tr key={c.id} {...rowProps(() => openClass(c), i)}>
                      {nameCell(c.label, `${Math.max(0, c.students - c.responses)} yet to respond`)}
                      {numberCells(c)}
                    </tr>
                  ))}
            </tbody>
            {levelTotals && (
              <tfoot>
                <tr className="bg-surface-stroke/50 font-bold">
                  <td className={footCell}>
                    {level === "wings"
                      ? `School total, ${wings.length} wings`
                      : currentWing
                        ? `${currentWing.name} total`
                        : "Total"}
                  </td>
                  {level === "wings" && (
                    <td className={cn(footCell, "text-right tabular-nums")}>{classes.length}</td>
                  )}
                  <td className={cn(footCell, "text-right tabular-nums")}>{levelTotals.students}</td>
                  <td className={cn(footCell, "text-right tabular-nums")}>{levelTotals.responses}</td>
                  <td className={cn(footCell, "text-right tabular-nums")}>{rate(levelTotals.responses, levelTotals.students)}</td>
                  <td className={cn(footCell, "text-right tabular-nums")}>{rating(levelTotals.avg)}</td>
                  {slotBookingEnabled && (
                    <>
                      <td className={cn(footCell, "text-right tabular-nums")}>
                        {levelTotals.booked} / {levelTotals.slots}
                      </td>
                      <td className={cn(footCell, "text-right tabular-nums")}>{levelTotals.attended}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            )}
          </TradTable>
        )}

        {/* What each column means is behind its "i" now; only the family
            list still needs a word on what it leaves out. */}
        {level === "students" && (
          <p className="py-3 text-[11.5px] leading-[1.55] text-ink-500">
            Only families who sent feedback are listed; the count of those yet to respond is above.
          </p>
        )}
      </div>

      <FeedbackDetailSheet row={openRow} onClose={() => setOpenRow(null)} />
    </V5Card>
  );
}

function StudentLevel({
  classLabel,
  rows,
  total,
  page,
  pageCount,
  isLoading,
  isError,
  isFetching,
  onRetry,
  onPage,
  onOpen,
  filterSlot,
  activeFilters,
  onClearFilters,
}: {
  classLabel: string;
  rows: PTMFeedbackRow[];
  total: number;
  page: number;
  pageCount: number;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  onPage: (page: number) => void;
  onOpen: (row: PTMFeedbackRow) => void;
  filterSlot: ReactNode;
  activeFilters: number;
  onClearFilters: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {filterSlot}
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        )}
      </div>

      {isLoading ? (
        <V5Loading label={`Loading feedback for ${classLabel}`} />
      ) : isError ? (
        <V5Error label="Couldn't load this class's feedback." onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <V5Empty
          title={activeFilters > 0 ? "No feedback matches these filters" : "No feedback from this class yet"}
          sub={activeFilters > 0 ? "Clear the filters to see everything." : "Families can send feedback once the meeting starts."}
        />
      ) : (
        <div className={cn(isFetching && "opacity-70")}>
          <TradTable>
            <thead>
              <tr>
                <th className={thBase}>Student</th>
                <th className={cn(thBase, "text-right")}>Rating</th>
                <th className={thBase}>Message</th>
                <th className={thBase}>Voice note</th>
                <th className={cn(thBase, "text-right")}>Sent</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.feedback_id}
                  onClick={() => onOpen(r)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpen(r);
                    }
                  }}
                  className={cn(
                    "cursor-pointer",
                    i % 2 === 1 && "bg-surface-stroke/25",
                    "hover:bg-brand-primary/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary",
                  )}
                >
                  <td className={tdBase}>
                    <div className="truncate font-bold tracking-[-0.01em] text-ink-900">{r.student_name ?? "Student"}</div>
                    {r.guardian_name && (
                      <div className="mt-px truncate text-[11.5px] font-medium text-ink-500">{r.guardian_name}</div>
                    )}
                  </td>
                  <td className={cn(tdBase, "whitespace-nowrap text-right")}>
                    <Stars value={r.rating} />
                  </td>
                  <td className={cn(tdBase, "min-w-[200px] max-w-[360px]")}>
                    {r.text_message ? (
                      <p className="line-clamp-2 text-ink-700">{r.text_message}</p>
                    ) : (
                      <span className="text-ink-400">No message</span>
                    )}
                  </td>
                  <td className={cn(tdBase, "whitespace-nowrap")}>
                    {r.audio_path ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-brand-primary">
                        <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                        {formatDuration(r.audio_duration_seconds)}
                      </span>
                    ) : (
                      <span className="text-ink-400">None</span>
                    )}
                  </td>
                  <td className={cn(tdBase, "whitespace-nowrap text-right tabular-nums text-ink-600")}>
                    {format(new Date(r.submitted_at), "d MMM, h:mm a")}
                  </td>
                </tr>
              ))}
            </tbody>
          </TradTable>
        </div>
      )}

      {total > FEEDBACK_PAGE_SIZE && (
        <div className="flex items-center justify-between gap-2 text-sm text-ink-600">
          <span>
            {page * FEEDBACK_PAGE_SIZE + 1} to {Math.min(total, (page + 1) * FEEDBACK_PAGE_SIZE)} of {total}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => onPage(Math.max(0, page - 1))} disabled={page === 0}>
              <ChevronLeft aria-hidden="true" />
              <span className="sr-only">Previous page</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
              disabled={page >= pageCount - 1}
            >
              <ChevronRight aria-hidden="true" />
              <span className="sr-only">Next page</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FeedbackFilters({
  draft,
  onChange,
}: {
  draft: PTMFeedbackFilters;
  onChange: (next: PTMFeedbackFilters) => void;
}) {
  return (
    <div className="space-y-5 p-4">
      <div className="space-y-2">
        <Label htmlFor="fb-rating">Rating</Label>
        <Select
          value={draft.rating === null ? ANY : String(draft.rating)}
          onValueChange={(v) => onChange({ ...draft, rating: v === ANY ? null : Number(v) })}
        >
          <SelectTrigger id="fb-rating">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ANY}>Any rating</SelectItem>
            {[5, 4, 3, 2, 1].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} {n === 1 ? "star" : "stars"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="fb-audio">Has a voice note</Label>
        <Switch
          id="fb-audio"
          checked={draft.hasAudio === true}
          onCheckedChange={(checked) => onChange({ ...draft, hasAudio: checked ? true : null })}
        />
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="fb-text">Has a written message</Label>
        <Switch
          id="fb-text"
          checked={draft.hasText === true}
          onCheckedChange={(checked) => onChange({ ...draft, hasText: checked ? true : null })}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="fb-sort">Sort</Label>
        <Select value={draft.sort} onValueChange={(v) => onChange({ ...draft, sort: v as PTMFeedbackSort })}>
          <SelectTrigger id="fb-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

const RATING_WORDS = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];

/** One family's feedback in full, opened from its row: the fourth level,
 *  like the subject drawer on the Command Center. */
function FeedbackDetailSheet({ row, onClose }: { row: PTMFeedbackRow | null; onClose: () => void }) {
  const edited = row && row.updated_at !== row.submitted_at;
  return (
    <MobileSheet
      open={!!row}
      onOpenChange={(open) => !open && onClose()}
      title={row?.student_name ?? "Feedback"}
      subtitle={
        row
          ? [formatClassName(row.class_name, row.class_section), row.guardian_name].filter(Boolean).join(" · ")
          : undefined
      }
      placement="right"
    >
      {row && (
        <div className="space-y-5 p-4">
          <div className="flex items-center gap-3">
            <Stars value={row.rating} size="h-6 w-6" />
            <span className="text-sm font-medium text-ink-700">{RATING_WORDS[row.rating]}</span>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink-900">Message</p>
            {row.text_message ? (
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-sm text-ink-700">
                {row.text_message}
              </p>
            ) : (
              <p className="text-sm text-ink-500">No written message.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-ink-900">Voice note</p>
            {row.audio_path ? (
              <AudioPlayer path={row.audio_path} durationSeconds={row.audio_duration_seconds} label="Play voice note" />
            ) : (
              <p className="text-sm text-ink-500">No voice note.</p>
            )}
          </div>
          <p className="text-xs text-ink-500">
            Sent {format(new Date(row.submitted_at), "d MMM yyyy, h:mm a")}
            {edited ? `, last edited ${format(new Date(row.updated_at), "d MMM yyyy, h:mm a")}` : ""}.
          </p>
        </div>
      )}
    </MobileSheet>
  );
}
