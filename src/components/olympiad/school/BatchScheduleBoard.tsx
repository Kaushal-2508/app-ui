import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, KeyRound, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import {
  useOlympiadSchoolStudents,
  type RosterStudent,
} from "@/hooks/olympiad/useOlympiadClassRoster";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadResultsIndex } from "@/hooks/olympiad/useOlympiadResultsIndex";
import { useOlympiadStudentResults } from "@/hooks/olympiad/useOlympiadStudentResults";
import { useOlympiadBatchAssignmentMap } from "@/hooks/olympiad/useOlympiadBatchAssignmentMap";
import { StudentDetailSheet } from "@/components/olympiad/school/StudentDetailSheet";
import type { OlympiadBatch } from "@/hooks/olympiad/useOlympiadBatches";
import { cn } from "@/lib/utils";

function fmtIST(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const STATUS_META: Record<OlympiadBatch["status"], { label: string; cls: string }> = {
  completed: { label: "Conducted", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
  in_progress: { label: "In progress", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  locked: { label: "Scheduled", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  draft: { label: "Draft", cls: "bg-ink-400/15 text-ink-700" },
  cancelled: { label: "Cancelled", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

function AttendanceBadge({ status }: { status: "appeared" | "absent" | undefined }) {
  if (!status) return null;
  return status === "appeared" ? (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
      Appeared
    </span>
  ) : (
    <span className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
      Absent
    </span>
  );
}

/**
 * Locked-schedule view of the Batch Schedule page: every batch as a clickable
 * card (date, time, conducted status, attendance counts) opening that batch's
 * roster; below, the full attendance list — students who sat the exam first,
 * absentees (with the batch + subjects they missed) at the end.
 */
export function BatchScheduleBoard({
  olySchoolId,
  batches,
  onOpenPinCustody,
}: {
  olySchoolId: string;
  batches: OlympiadBatch[];
  onOpenPinCustody: () => void;
}) {
  const visibleBatches = useMemo(
    () => batches.filter((b) => b.status !== "cancelled" && b.status !== "draft"),
    [batches],
  );
  const batchIds = useMemo(() => visibleBatches.map((b) => b.id), [visibleBatches]);

  const navigate = useNavigate();
  const { data: students = [] } = useOlympiadSchoolStudents(olySchoolId);
  const { data: subjects } = useOlympiadSubjects();
  const { data: resultsIndex } = useOlympiadResultsIndex(olySchoolId);
  const { data: studentResults } = useOlympiadStudentResults(olySchoolId);
  const { data: assignMap } = useOlympiadBatchAssignmentMap(batchIds);

  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null);
  const [attFilter, setAttFilter] = useState("all");
  const [classFilter, setClassFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");

  const subjectNameById = useMemo(
    () => Object.fromEntries((subjects ?? []).map((s) => [s.id, s.name])),
    [subjects],
  );
  const batchById = useMemo(
    () => Object.fromEntries(visibleBatches.map((b) => [b.id, b])),
    [visibleBatches],
  );

  const activeStudents = useMemo(
    () =>
      students
        .filter((s) => s.status === "active")
        .sort(
          (a, b) =>
            a.class_label.localeCompare(b.class_label, undefined, { numeric: true }) ||
            a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true }),
        ),
    [students],
  );

  const hasAttendance = Object.keys(resultsIndex ?? {}).length > 0;
  const statusOf = (s: RosterStudent) => resultsIndex?.[s.id];

  const byBatch = useMemo(() => {
    const map: Record<string, RosterStudent[]> = {};
    for (const s of activeStudents) {
      const bid = assignMap?.[s.id];
      if (!bid) continue;
      (map[bid] ??= []).push(s);
    }
    return map;
  }, [activeStudents, assignMap]);

  const classOptions = useMemo(
    () =>
      Array.from(new Set(activeStudents.map((s) => s.class_label))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [activeStudents],
  );

  // One merged attendance list — absentees surface at the top (they need
  // action), appeared students after — narrowed by Attendance/Class/Batch.
  const filteredStudents = useMemo(() => {
    const rank = (s: RosterStudent) => (resultsIndex?.[s.id] === "appeared" ? 1 : 0);
    return activeStudents
      .filter((s) => classFilter === "all" || s.class_label === classFilter)
      .filter((s) => batchFilter === "all" || assignMap?.[s.id] === batchFilter)
      .filter((s) => {
        if (attFilter === "all" || !hasAttendance) return true;
        return attFilter === "appeared"
          ? resultsIndex?.[s.id] === "appeared"
          : resultsIndex?.[s.id] !== "appeared";
      })
      .slice()
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          a.class_label.localeCompare(b.class_label, undefined, { numeric: true }) ||
          a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true }),
      );
  }, [activeStudents, resultsIndex, hasAttendance, attFilter, classFilter, batchFilter, assignMap]);

  const subjectsLabel = (s: RosterStudent) =>
    s.subject_ids.map((id) => subjectNameById[id] ?? "?").join(", ");
  const missedBatchLabel = (s: RosterStudent) => {
    const bid = assignMap?.[s.id];
    return bid ? batchById[bid]?.batch_label ?? "N/A" : "No batch assigned";
  };

  const StudentRow = ({ s, showMissed }: { s: RosterStudent; showMissed?: boolean }) => (
    <div
      role="button"
      tabIndex={0}
      onClick={() => setSelectedStudent(s)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setSelectedStudent(s);
        }
      }}
      className="flex items-center gap-3 px-3 py-2.5 surface-card frosted-shadow rounded-card cursor-pointer transition-shadow hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
    >
      <div className="flex-1 min-w-0 space-y-0.5">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-ink-900">{s.full_name}</p>
          <Badge variant="outline" className="text-[10px]">{s.class_label}</Badge>
        </div>
        <p className="text-[11px] text-ink-500 truncate">
          {s.roll_number}
          {showMissed
            ? ` · Missed: ${missedBatchLabel(s)} · ${subjectsLabel(s)}`
            : ` · ${subjectsLabel(s)}`}
        </p>
      </div>
      <AttendanceBadge status={statusOf(s)} />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Batches */}
      <section className="space-y-3">
        <header className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="eyebrow">Schedule locked</p>
            <h3 className="text-base font-semibold text-ink-900">
              {visibleBatches.length} batch{visibleBatches.length === 1 ? "" : "es"}
            </h3>
          </div>
          <Button size="sm" variant="outline" onClick={onOpenPinCustody}>
            <KeyRound className="h-4 w-4 mr-1" /> PIN custody
          </Button>
        </header>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visibleBatches.map((b) => {
            const assigned = byBatch[b.id] ?? [];
            const appeared = assigned.filter((s) => statusOf(s) === "appeared").length;
            const meta = STATUS_META[b.status];
            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/school/olympiad/batches/${b.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/school/olympiad/batches/${b.id}`);
                  }
                }}
                className="surface-card frosted-shadow rounded-card p-4 space-y-2 cursor-pointer transition-shadow hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-900">{b.batch_label}</p>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", meta.cls)}>
                    {meta.label}
                  </span>
                </div>
                <p className="flex items-center gap-1.5 text-[12px] text-ink-600">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  {fmtIST(b.scheduled_at)}
                </p>
                <p className="text-[11px] text-ink-500">
                  {assigned.length} student{assigned.length === 1 ? "" : "s"}
                  {hasAttendance && (
                    <> · {appeared} appeared · {assigned.length - appeared} absent</>
                  )}
                  {b.is_absentees && " · makeup batch"}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Attendance — one merged list (appeared first, absentees last) + filters */}
      <section className="space-y-3">
        <header>
          <p className="eyebrow">Exam attendance</p>
          <h3 className="text-base font-semibold text-ink-900">All students</h3>
        </header>
        <div className="flex flex-wrap items-center gap-2">
          {hasAttendance && (
            <Select value={attFilter} onValueChange={setAttFilter}>
              <SelectTrigger className="h-9 w-[140px]">
                <SelectValue placeholder="Attendance" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All students</SelectItem>
                <SelectItem value="appeared">Appeared</SelectItem>
                <SelectItem value="absent">Absent</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue placeholder="Class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {classOptions.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={batchFilter} onValueChange={setBatchFilter}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="Batch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All batches</SelectItem>
              {visibleBatches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.batch_label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[12px] tabular-nums text-ink-500">
            {filteredStudents.length} student{filteredStudents.length === 1 ? "" : "s"}
          </span>
        </div>
        {filteredStudents.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="No matches"
            description="No student matches the chosen filters."
            reason="noResults"
          />
        ) : (
          <div className="space-y-2">
            {filteredStudents.map((s) => (
              <StudentRow key={s.id} s={s} showMissed={hasAttendance && resultsIndex?.[s.id] !== "appeared"} />
            ))}
          </div>
        )}
      </section>

      <StudentDetailSheet
        student={selectedStudent}
        onOpenChange={(open) => {
          if (!open) setSelectedStudent(null);
        }}
        subjectNameById={subjectNameById}
        result={selectedStudent ? studentResults?.[selectedStudent.id] ?? null : null}
      />
    </div>
  );
}
