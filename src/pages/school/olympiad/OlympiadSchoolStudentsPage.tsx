import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, List, Loader2, Search, Upload, UserPlus, Users } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader, type PageHeaderAction } from "@/components/shared/page/PageHeader";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadSchoolStudents, type RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import { useOlympiadStudentResults } from "@/hooks/olympiad/useOlympiadStudentResults";
import { StudentPerformanceTable } from "@/components/olympiad/school/StudentPerformanceTable";
import { Button } from "@/components/ui/button";
import { StudentDetailSheet } from "@/components/olympiad/school/StudentDetailSheet";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { useOlympiadGradeSubjects } from "@/hooks/olympiad/useOlympiadGradeSubjects";
import { StudentRosterRow } from "@/components/olympiad/teacher/StudentRosterRow";
import { CashEnrollSheet } from "@/components/olympiad/teacher/CashEnrollSheet";
import { BulkEnrollStudentsSheet } from "@/components/olympiad/school/BulkEnrollStudentsSheet";

type EnrollGrade = { gradeLevelId: string; classLabel: string };

export default function OlympiadSchoolStudentsPage() {
  const location = useLocation();
  const { data: school } = useOlympiadMySchool();
  const { data: students = [], isLoading } = useOlympiadSchoolStudents(school?.id);
  const { data: subjects } = useOlympiadSubjects();
  const { data: olyClasses = [] } = useOlympiadClasses();
  // Dashboard KPI tiles and Analytics charts deep-link here pre-filtered
  // (payment channel, class bar, a topper's name as a search, or a Medal mix
  // slice as an award tier — the latter lands straight on the Report view).
  const incoming = location.state as
    | {
        channelFilter?: string;
        classFilter?: string;
        search?: string;
        appearedFilter?: string;
        tierFilter?: string;
        view?: "list" | "report";
      }
    | null;
  const [search, setSearch] = useState(() => incoming?.search ?? "");
  const [classFilter, setClassFilter] = useState(() => incoming?.classFilter ?? "all");
  const [channelFilter, setChannelFilter] = useState(() => incoming?.channelFilter ?? "all");
  const [appearedFilter, setAppearedFilter] = useState(() => incoming?.appearedFilter ?? "all");
  const [tierFilter, setTierFilter] = useState(() => incoming?.tierFilter ?? "all");
  // Roster cards by default; the Report button (visible once results exist)
  // switches to the per-subject performance table.
  const [view, setView] = useState<"list" | "report">(() => incoming?.view ?? "list");
  // Published results per student — powers the Appeared/Absent filter and the
  // Report view; both only appear once at least some results are published.
  const { data: studentResults } = useOlympiadStudentResults(school?.id);
  const hasResultsData = Object.keys(studentResults ?? {}).length > 0;
  const [enrollGrade, setEnrollGrade] = useState<EnrollGrade | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<RosterStudent | null>(null);

  const { data: enrollSubjects = [] } = useOlympiadGradeSubjects(enrollGrade?.gradeLevelId);

  const subjectNameById = useMemo(
    () => Object.fromEntries((subjects ?? []).map((s) => [s.id, s.name])),
    [subjects],
  );

  // The school's participating classes (with labels), for the enroll picker.
  const participatingClasses = useMemo<EnrollGrade[]>(() => {
    const allowed = new Set(school?.participating_grade_level_ids ?? []);
    return olyClasses
      .filter((c) => allowed.has(c.grade_level_id))
      .map((c) => ({
        gradeLevelId: c.grade_level_id,
        // grade_name is canonical ("Class 9", "Class 11 Commerce") - Class ${n}
        // would mislabel stream classes whose grade_number runs 11-18.
        classLabel: c.grade_name,
      }));
  }, [olyClasses, school?.participating_grade_level_ids]);

  // Admin-driven enrollment is for onboarded (non-SALCI) schools, where the admin
  // is the operator. Existing-SALCI schools enrol through the teacher roster flow.
  const canEnroll = school?.is_existing_salci_school === false && participatingClasses.length > 0;

  // Arriving from the dashboard "Onboard students" tile: with a single class the
  // enroll sheet opens immediately; with several, the class menu is one tap away
  // in the header. The ref makes auto-open once-only so closing the sheet sticks.
  const autoOpened = useRef(false);
  useEffect(() => {
    const wantsEnroll = (location.state as { openEnroll?: boolean } | null)?.openEnroll;
    if (wantsEnroll && canEnroll && participatingClasses.length === 1 && !autoOpened.current) {
      autoOpened.current = true;
      setEnrollGrade(participatingClasses[0]);
    }
  }, [location.state, canEnroll, participatingClasses]);
  const primaryAction: PageHeaderAction | undefined = !canEnroll
    ? undefined
    : participatingClasses.length === 1
      ? {
          label: "Enroll student",
          icon: <UserPlus className="h-4 w-4" />,
          onClick: () => setEnrollGrade(participatingClasses[0]),
        }
      : {
          label: "Enroll student",
          icon: <UserPlus className="h-4 w-4" />,
          menuItems: participatingClasses.map((c) => ({
            label: c.classLabel,
            onClick: () => setEnrollGrade(c),
          })),
        };

  const activeStudents = useMemo(
    () => students.filter((s) => s.status === "active"),
    [students],
  );

  // Filter options come from the data itself, so they always match the roster.
  const classOptions = useMemo(
    () =>
      Array.from(new Set(activeStudents.map((s) => s.class_label))).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true }),
      ),
    [activeStudents],
  );
  // One merged list across all classes, narrowed by search + filters.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeStudents
      .filter((s) => classFilter === "all" || s.class_label === classFilter)
      .filter((s) => channelFilter === "all" || s.enrollment_channel === channelFilter)
      .filter((s) => {
        if (appearedFilter === "all") return true;
        const tier = studentResults?.[s.id]?.certificate_tier;
        if (!tier) return false;
        return appearedFilter === "appeared" ? tier !== "absent" : tier === "absent";
      })
      .filter((s) => tierFilter === "all" || studentResults?.[s.id]?.certificate_tier === tierFilter)
      .filter(
        (s) =>
          !q ||
          s.full_name.toLowerCase().includes(q) ||
          s.roll_number.toLowerCase().includes(q) ||
          (s.admission_number ?? "").toLowerCase().includes(q),
      )
      .sort(
        (a, b) =>
          a.class_label.localeCompare(b.class_label, undefined, { numeric: true }) ||
          a.roll_number.localeCompare(b.roll_number, undefined, { numeric: true }),
      );
  }, [activeStudents, search, classFilter, channelFilter, appearedFilter, tierFilter, studentResults]);

  const total = filtered.length;
  const hasFilters =
    classFilter !== "all" || channelFilter !== "all" || appearedFilter !== "all" || tierFilter !== "all";
  const showSignIn = school?.is_existing_salci_school === false;

  return (
    <PageShell>
      <NavLink
        to="/school/olympiad"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>

      <PageHeader
        title="Olympiad Students"
        subtitle={school?.institution_name}
        icon={<Users className="h-6 w-6" />}
        primaryAction={primaryAction}
        extras={
          canEnroll ? (
            <Button variant="outline" onClick={() => setBulkOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Bulk upload
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4 py-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, roll, or admission no."
            className="pl-9"
          />
        </div>

        {/* Filters — one merged list across classes, narrowed here */}
        <div className="flex flex-wrap items-center gap-2">
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
          <Select value={channelFilter} onValueChange={setChannelFilter}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue placeholder="Payment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All payments</SelectItem>
              <SelectItem value="parent_online">Online</SelectItem>
              <SelectItem value="teacher_cash">Cash</SelectItem>
            </SelectContent>
          </Select>
          {/* Exam attendance + award tier — only meaningful once results are published */}
          {hasResultsData && (
            <>
              <Select value={appearedFilter} onValueChange={setAppearedFilter}>
                <SelectTrigger className="h-9 w-[140px]">
                  <SelectValue placeholder="Attendance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All students</SelectItem>
                  <SelectItem value="appeared">Appeared</SelectItem>
                  <SelectItem value="absent">Absent</SelectItem>
                </SelectContent>
              </Select>
              <Select value={tierFilter} onValueChange={setTierFilter}>
                <SelectTrigger className="h-9 w-[150px]">
                  <SelectValue placeholder="Award" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All awards</SelectItem>
                  <SelectItem value="gold">Gold</SelectItem>
                  <SelectItem value="silver">Silver</SelectItem>
                  <SelectItem value="bronze">Bronze</SelectItem>
                  <SelectItem value="participation">Participation</SelectItem>
                </SelectContent>
              </Select>
            </>
          )}
          <span className="ml-auto text-[12px] tabular-nums text-ink-500">
            {total} student{total === 1 ? "" : "s"}
          </span>
          {/* Report toggle — per-subject marks table, available once results exist */}
          {hasResultsData && (
            <Button
              size="sm"
              variant={view === "report" ? "default" : "outline"}
              onClick={() => setView((v) => (v === "report" ? "list" : "report"))}
            >
              {view === "report" ? (
                <><List className="mr-1.5 h-4 w-4" /> List</>
              ) : (
                <><BarChart3 className="mr-1.5 h-4 w-4" /> Report</>
              )}
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : total === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={search || hasFilters ? "No matches" : "No students enrolled yet"}
            description={
              search || hasFilters
                ? "No enrolled student matches your search or filters."
                : canEnroll
                  ? "Use “Enroll student” above to add your first student."
                  : "Enrolled students will appear here."
            }
            reason={search || hasFilters ? "noResults" : "noData"}
          />
        ) : view === "report" && hasResultsData ? (
          <StudentPerformanceTable
            rows={filtered.map((s) => ({ student: s, result: studentResults?.[s.id] ?? null }))}
            onSelect={setSelectedStudent}
          />
        ) : (
          <div className="space-y-2">
            {filtered.map((s) => (
              <StudentRosterRow
                key={s.id}
                student={s}
                subjectNameById={subjectNameById}
                showSignInDetails={showSignIn}
                showClassBadge
                onSelect={setSelectedStudent}
              />
            ))}
          </div>
        )}
      </div>

      <StudentDetailSheet
        student={selectedStudent}
        onOpenChange={(open) => {
          if (!open) setSelectedStudent(null);
        }}
        subjectNameById={subjectNameById}
        result={selectedStudent ? studentResults?.[selectedStudent.id] ?? null : null}
      />

      {school && (
        <CashEnrollSheet
          open={!!enrollGrade}
          onOpenChange={(o) => {
            if (!o) setEnrollGrade(null);
          }}
          olySchoolId={school.id}
          gradeLevelId={enrollGrade?.gradeLevelId ?? ""}
          classLabel={enrollGrade?.classLabel ?? ""}
          availableSubjects={enrollSubjects}
          isExistingSalciSchool={school.is_existing_salci_school}
        />
      )}

      {school && canEnroll && (
        <BulkEnrollStudentsSheet
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          olySchoolId={school.id}
          classes={participatingClasses.map((c) => ({
            gradeLevelId: c.gradeLevelId,
            label: c.classLabel,
          }))}
        />
      )}
    </PageShell>
  );
}
