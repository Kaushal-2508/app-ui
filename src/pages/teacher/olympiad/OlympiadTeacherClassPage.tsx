// src/pages/teacher/olympiad/OlympiadTeacherClassPage.tsx
import { useMemo, useState } from "react";
import { ArrowLeft, BarChart3, Banknote, CreditCard, Loader2, Plus, Search, Users } from "lucide-react";
import { NavLink, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { MobileFab } from "@/components/shared/page/MobileFab";
import { Button } from "@/components/ui/button";
import { StudentDetailSheet } from "@/components/olympiad/school/StudentDetailSheet";
import { ClassMetricSheet, type ClassMetric } from "@/components/olympiad/teacher/ClassMetricSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOlympiadClassRoster } from "@/hooks/olympiad/useOlympiadClassRoster";
import { useOlympiadBatchesNoPin } from "@/hooks/olympiad/useOlympiadBatchesNoPin";
import { useOlympiadGradeSubjects } from "@/hooks/olympiad/useOlympiadGradeSubjects";
import { useTeacherOlympiadClassReport } from "@/hooks/olympiad/useTeacherOlympiadClassReport";
import { useOlympiadStudentResults } from "@/hooks/olympiad/useOlympiadStudentResults";
import { StudentRosterRow } from "@/components/olympiad/teacher/StudentRosterRow";
import { CashEnrollSheet } from "@/components/olympiad/teacher/CashEnrollSheet";
import { EditStudentSheet } from "@/components/olympiad/teacher/EditStudentSheet";
import { RemoveStudentDialog } from "@/components/olympiad/teacher/RemoveStudentDialog";
import { PrintCredentialsButton } from "@/components/olympiad/teacher/PrintCredentialsButton";
import { TeacherClassResultsPanel } from "@/components/olympiad/teacher/TeacherClassResultsPanel";
import { StudentScorecardSheet } from "@/components/olympiad/teacher/StudentScorecardSheet";
import { supabase } from "@/integrations/supabase/client";
import type { RosterStudent, RosterFilters } from "@/hooks/olympiad/useOlympiadClassRoster";

// Small helper hook — fetches school + grade info for the page header
function useOlympiadClassMeta(olySchoolId: string | undefined, gradeLevelId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "class-meta", olySchoolId, gradeLevelId],
    queryFn: async () => {
      if (!olySchoolId || !gradeLevelId) return null;
      const [schoolRes, gradeRes] = await Promise.all([
        supabase
          .from("oly_schools")
          .select("school_short_code, status, is_existing_salci_school, institutions(name)")
          .eq("id", olySchoolId)
          .maybeSingle(),
        supabase
          .from("grade_levels")
          .select("grade_name, grade_number")
          .eq("id", gradeLevelId)
          .maybeSingle(),
      ]);
      if (schoolRes.error) throw schoolRes.error;
      if (gradeRes.error) throw gradeRes.error;
      const school = schoolRes.data;
      const grade = gradeRes.data;
      const inst = school
        ? (Array.isArray(school.institutions) ? school.institutions[0] : school.institutions)
        : null;
      return {
        schoolShortCode: school?.school_short_code ?? "",
        schoolStatus: school?.status ?? "enrollment_open",
        isExistingSalciSchool: school?.is_existing_salci_school === true,
        institutionName: (inst as { name?: string } | null)?.name ?? "(school)",
        gradeName: grade?.grade_name ?? "",
        gradeNumber: grade?.grade_number ?? null,
      };
    },
    enabled: !!olySchoolId && !!gradeLevelId,
    staleTime: 60_000,
  });
}

type SortKey = "roll" | "name" | "score";

export default function OlympiadTeacherClassPage() {
  const { olySchoolId, gradeLevelId } = useParams<{
    olySchoolId: string;
    gradeLevelId: string;
  }>();

  const [filters, setFilters] = useState<RosterFilters>({ channel: null, status: "active" });
  const [editing, setEditing] = useState<RosterStudent | null>(null);
  const [removing, setRemoving] = useState<RosterStudent | null>(null);
  const [cashOpen, setCashOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortKey>("roll");
  const [scorecardId, setScorecardId] = useState<string | null>(null);
  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null);
  const [metric, setMetric] = useState<ClassMetric | null>(null);

  const { data: meta, isLoading: metaLoading } = useOlympiadClassMeta(olySchoolId, gradeLevelId);
  const { data: roster, isLoading: rosterLoading } = useOlympiadClassRoster(
    olySchoolId,
    gradeLevelId,
    filters,
  );
  const { data: batches } = useOlympiadBatchesNoPin(olySchoolId, gradeLevelId);
  const scheduleBatch = (batches ?? []).find((b) => b.status !== "cancelled");

  // Class-scoped report (avg / appeared / channel split) — server-aggregated and
  // grade-scoped (§23). Drives the KPI header and gates the Results panel. Falls
  // back to roster-derived counts if the report ever fails to load.
  const { data: report } = useTeacherOlympiadClassReport(olySchoolId, gradeLevelId);
  // Per-student published results — powers the score sort + the Results panel.
  const { data: studentResults } = useOlympiadStudentResults(olySchoolId);
  const resultsAvailable = !!report?.results_available;

  // ALL Olympiad subjects configured for this grade — drives both the cash
  // enroll subject picker and the roster subject-name map. Must be grade-wide
  // (NOT derived from the existing roster): deriving it from enrolled students
  // meant a class with no students yet exposed zero subjects, so the picker
  // never rendered and the very first enrollment was impossible.
  const { data: availableSubjects = [] } = useOlympiadGradeSubjects(gradeLevelId);

  // Build subject name map for roster rows. Subjects no longer mapped to the
  // grade fall back to "?" in the row renderer.
  const subjectNameById = Object.fromEntries(availableSubjects.map((s) => [s.id, s.name]));

  const isLoading = metaLoading || rosterLoading;
  const activeCount = (roster ?? []).filter((s) => s.status === "active").length;
  const removedCount = (roster ?? []).filter((s) => s.status === "removed").length;
  const cashCount = report?.channel.cash
    ?? (roster ?? []).filter((s) => s.status === "active" && s.enrollment_channel === "teacher_cash").length;
  const onlineCount = report?.channel.online
    ?? (roster ?? []).filter((s) => s.status === "active" && s.enrollment_channel === "parent_online").length;
  const enrolledCount = report?.enrolled ?? activeCount;

  const classLabel = meta?.gradeNumber != null ? `Class ${meta.gradeNumber}` : (meta?.gradeName ?? "");
  const enrollmentOpen = meta?.schoolStatus === "enrollment_open";

  const clearFilters = () => setFilters({ channel: null, status: "active" });

  // Search + sort layered on top of the channel/status-filtered roster.
  const visibleRoster = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (roster ?? []).filter(
      (s) =>
        !q ||
        s.full_name.toLowerCase().includes(q) ||
        s.roll_number.toLowerCase().includes(q) ||
        (s.admission_number ?? "").toLowerCase().includes(q),
    );
    const sorted = [...list];
    if (sortBy === "name") {
      sorted.sort((a, b) => a.full_name.localeCompare(b.full_name));
    } else if (sortBy === "score") {
      sorted.sort(
        (a, b) => (studentResults?.[b.id]?.percentage ?? -1) - (studentResults?.[a.id]?.percentage ?? -1),
      );
    } else {
      sorted.sort((a, b) => a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true }));
    }
    return sorted;
  }, [roster, search, sortBy, studentResults]);

  return (
    <PageShell>
      <NavLink
        to="/teacher/olympiad"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> My classes
      </NavLink>

      <PageHeader
        title={meta?.gradeName ?? "Class roster"}
        subtitle={meta ? `${meta.institutionName} · ${meta.schoolShortCode}` : undefined}
        primaryAction={
          enrollmentOpen
            ? {
                label: "Enroll student",
                onClick: () => setCashOpen(true),
                icon: <Plus className="h-4 w-4" />,
              }
            : undefined
        }
      />

      {/* Batch schedule info + print credentials */}
      {olySchoolId && gradeLevelId && (scheduleBatch || !isLoading) && (
        <div className="surface-card frosted-shadow rounded-card p-3 flex items-center justify-between mb-3">
          <div>
            <p className="eyebrow">Exam batch</p>
            {scheduleBatch ? (
              <p className="text-sm font-medium text-ink-900">
                {new Date(scheduleBatch.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}
              </p>
            ) : (
              <p className="text-sm text-ink-500">Not scheduled yet</p>
            )}
          </div>
          <PrintCredentialsButton olySchoolId={olySchoolId} gradeLevelId={gradeLevelId} />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      ) : (
        <>
          {/* Stage-aware KPI header */}
          <StatTileGrid cols={2} mdCols={4} className="mb-4">
            <StatTile
              label="Enrolled"
              value={String(enrolledCount)}
              icon={<Users className="h-4 w-4" />}
              tone="teal"
              onClick={() => setMetric("enrolled")}
            />
            {resultsAvailable ? (
              <>
                <StatTile
                  label="Appeared"
                  value={`${report?.appeared ?? 0}/${enrolledCount}`}
                  icon={<BarChart3 className="h-4 w-4" />}
                  tone="mint"
                  onClick={() => setMetric("appeared")}
                />
                <StatTile
                  label="Average"
                  value={`${report?.avg_percentage ?? 0}%`}
                  icon={<BarChart3 className="h-4 w-4" />}
                  tone="violet"
                  onClick={() => setMetric("average")}
                />
                <StatTile
                  label="Highest"
                  value={`${report?.max_percentage ?? 0}%`}
                  icon={<BarChart3 className="h-4 w-4" />}
                  tone="sky"
                  onClick={() => setMetric("highest")}
                />
              </>
            ) : (
              <>
                <StatTile
                  label="Cash"
                  value={String(cashCount)}
                  icon={<Banknote className="h-4 w-4" />}
                  tone="mint"
                  onClick={() => setFilters((f) => ({ ...f, channel: "teacher_cash" }))}
                />
                <StatTile
                  label="Online"
                  value={String(onlineCount)}
                  icon={<CreditCard className="h-4 w-4" />}
                  tone="sky"
                  onClick={() => setFilters((f) => ({ ...f, channel: "parent_online" }))}
                />
                <StatTile
                  label="Removed"
                  value={String(removedCount)}
                  icon={<Users className="h-4 w-4" />}
                  tone="rose"
                  onClick={() => setFilters((f) => ({ ...f, status: "removed" }))}
                />
              </>
            )}
          </StatTileGrid>

          {/* Results — only once the class has sat the exam */}
          {resultsAvailable && (
            <div className="mb-5">
              <TeacherClassResultsPanel
                olySchoolId={olySchoolId}
                gradeLevelId={gradeLevelId}
                roster={roster ?? []}
                onOpenStudent={setScorecardId}
                onMetric={setMetric}
              />
            </div>
          )}

          {/* Roster */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="eyebrow">Roster</p>
            <span className="text-[12px] tabular-nums text-ink-500">
              {visibleRoster.filter((s) => s.status === "active").length} active
              {removedCount > 0 && ` · ${removedCount} removed`}
            </span>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, roll, or admission no."
              className="h-10 pl-9"
            />
          </div>

          {/* Filters — clean dropdowns (sort · channel · status) */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
              <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="roll">By roll number</SelectItem>
                <SelectItem value="name">By name</SelectItem>
                {resultsAvailable && <SelectItem value="score">By score</SelectItem>}
              </SelectContent>
            </Select>
            <Select
              value={filters.channel ?? "all"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, channel: v === "all" ? null : (v as RosterFilters["channel"]) }))
              }
            >
              <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All channels</SelectItem>
                <SelectItem value="teacher_cash">Cash</SelectItem>
                <SelectItem value="parent_online">Online</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={filters.status ?? "all"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, status: v === "all" ? null : (v as RosterFilters["status"]) }))
              }
            >
              <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="removed">Removed</SelectItem>
                <SelectItem value="all">All statuses</SelectItem>
              </SelectContent>
            </Select>
            {(filters.channel != null || filters.status !== "active") && (
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-ink-500 hover:text-ink-900"
                onClick={clearFilters}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Roster list */}
          {visibleRoster.length === 0 ? (
            <EmptyState
              icon={<Users className="h-8 w-8" />}
              title={search ? "No matches" : "No students yet"}
              description={
                search
                  ? "No enrolled student matches your search."
                  : enrollmentOpen
                    ? "Use the + button below to enroll a cash student."
                    : "Enrollment is closed for this school."
              }
              reason={search ? "noResults" : "noData"}
              action={
                !search && enrollmentOpen
                  ? { label: "Enroll cash student", onClick: () => setCashOpen(true) }
                  : undefined
              }
            />
          ) : (
            <div className="space-y-2 pb-24">
              {visibleRoster.map((student) => (
                <StudentRosterRow
                  key={student.id}
                  student={student}
                  subjectNameById={subjectNameById}
                  onEdit={setEditing}
                  onRemove={setRemoving}
                  showSignInDetails={!meta?.isExistingSalciSchool}
                  onSelect={setSelectedStudent}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* FAB — only shown when enrollment is open */}
      {enrollmentOpen && (
        <MobileFab
          label="Enroll cash student"
          icon={<Plus className="h-6 w-6" />}
          onClick={() => setCashOpen(true)}
        />
      )}

      {/* Sheets & dialogs */}
      <CashEnrollSheet
        open={cashOpen}
        onOpenChange={setCashOpen}
        olySchoolId={olySchoolId ?? ""}
        gradeLevelId={gradeLevelId ?? ""}
        classLabel={classLabel}
        availableSubjects={availableSubjects}
        isExistingSalciSchool={meta?.isExistingSalciSchool ?? false}
      />

      <EditStudentSheet
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        student={editing}
      />

      <RemoveStudentDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        student={removing}
      />

      <StudentScorecardSheet
        studentId={scorecardId}
        onOpenChange={(o) => !o && setScorecardId(null)}
      />

      {/* Student profile — same flow as the school-admin roster. The result CTA
          opens the teacher scorecard (the school dashboard route is admin-only). */}
      <StudentDetailSheet
        student={selectedStudent}
        onOpenChange={(o) => { if (!o) setSelectedStudent(null); }}
        subjectNameById={subjectNameById}
        result={selectedStudent ? (studentResults?.[selectedStudent.id] ?? null) : null}
        dashboardLabel="View full result"
        onOpenDashboard={() => {
          if (!selectedStudent) return;
          const id = selectedStudent.id;
          setSelectedStudent(null);
          setScorecardId(id);
        }}
      />

      {/* KPI drill-down — each class tile opens its related students + stats */}
      <ClassMetricSheet
        metric={metric}
        onOpenChange={(o) => { if (!o) setMetric(null); }}
        roster={roster ?? []}
        studentResults={studentResults}
        report={report}
        onSelectStudent={(s) => { setMetric(null); setSelectedStudent(s); }}
      />
    </PageShell>
  );
}
