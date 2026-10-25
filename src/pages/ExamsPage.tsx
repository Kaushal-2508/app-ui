import { useNavigate, useSearchParams } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { format } from "date-fns";
import {
  FileText,
  FileSearch,
  Plus,
  Edit3,
  Eye,
  MoreHorizontal,
  Search,
  Trash2,
  CalendarIcon,
  User,
  GraduationCap,
  LayoutGrid,
  List as ListIcon,
  Clock,
  CalendarDays,
  Copy,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { useState, useMemo, useCallback, useEffect } from "react";
import { DateRange } from "react-day-picker";
import { cn, formatClassName } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { compareClassRows } from "@/lib/classSort";
import { useTeacherExams, useSchoolExams } from "@/hooks/useDashboardData";
import { useDeleteExam } from "@/hooks/useExamData";
import {
  useExamResultProgress,
  type ExamResultProgress,
} from "@/hooks/useExamResultProgress";
import { useCoordinatorExams, useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useTeacherAssignedSubjects } from "@/hooks/useTeacherAssignedSubjects";
import { useAuth } from "@/hooks/useAuth";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { TargetsHeaderButton } from "@/components/targets/TargetsHeaderButton";
import { useExamDrafts, useDuplicateExamDraft } from "@/hooks/useExamDrafts";
import { ExamDetailsSheet } from "@/components/exam/ExamDetailsSheet";
import { ExamPreviewDialog } from "@/components/exam/ExamPreviewDialog";
import { DraftsTab } from "@/components/exam-creation/screens/DraftsTab";
import { DownloadQuestionPaperButton } from "@/components/exam/DownloadQuestionPaperButton";
import { OfflineMarksSheet } from "@/components/exam/OfflineMarksSheet";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterSheet } from "@/components/shared/nav";
import { TeacherAssignment } from "@/hooks/useTeacherAssignedSubjects";

type ExamRow = {
  id: string;
  title?: string;
  status?: string;
  created_at: string;
  exam_mode?: "online" | "offline" | "hybrid";
  is_offline?: boolean;
  is_results_only?: boolean;
  total_marks?: number;
  duration_minutes?: number;
  created_by?: string;
  scheduled_date?: string | null;
  /** Needed by the "Live Exam" filter — the exam's own schedule window. */
  start_time?: string | null;
  end_time?: string | null;
  exam_classes?: Array<{
    class_id?: string;
    classes?: { name?: string; section?: string | null };
  }>;
  exam_subjects?: Array<{
    subject_id?: string;
    universal_subjects?: { name?: string };
  }>;
  profiles?: { full_name?: string } | null;
};

type ExamModeFilter = "all" | "online" | "offline" | "hybrid";

export default function ExamsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: roleInfo } = useUserRole();
  const { institutionId: effectiveInstitutionId, isManagingAsAdmin } = useEffectiveInstitution();
  const { data: teacherAssignments } = useTeacherAssignedSubjects(user?.id);
  // Shared app-wide "viewing as" state. The ONLY control that writes it is the
  // compact RoleSwitcher in the app bar (AppLayout, since 2026-09-09), which is
  // on every page; this page reads it and mounts no switcher of its own
  // (CLAUDE.md §25). The homework/classes/syllabus scopes read the same value.
  // `viewRoles` only decides which hat the subtitle tells the user to switch to.
  const { activeViewRole, hasDualRole, viewRoles } = useActiveRole();

  // A super admin managing someone else's institution is always in admin scope:
  // they are not a member of staff there and have no teaching assignments. A
  // school admin who ALSO holds the teacher role follows the toggle.
  const isAdminCapable = !!roleInfo?.isSchoolAdmin || isManagingAsAdmin;
  const isSchoolAdminView =
    isAdminCapable && (isManagingAsAdmin || !hasDualRole || activeViewRole === "admin");

  const {
    data: teacherExams,
    isLoading: teacherLoading,
    isError: teacherError,
    refetch: refetchTeacherExams,
  } = useTeacherExams();
  const {
    data: coordinatorExams,
    isLoading: coordLoading,
    isError: coordError,
    refetch: refetchCoordinatorExams,
  } = useCoordinatorExams();
  const {
    data: schoolExams,
    isLoading: schoolLoading,
    isError: schoolError,
    refetch: refetchSchoolExams,
  } = useSchoolExams(isSchoolAdminView ? effectiveInstitutionId : null);
  // Same query key as the one inside useCoordinatorExams, so this is a cache
  // read, not a second fetch. Needed so the page keeps showing the skeleton
  // while the wing class ids resolve, instead of flashing the teacher-only
  // list and then growing.
  const { isLoading: coordClassesLoading } = useCoordinatorClasses();

  /**
   * Scope selection for dual teacher+coordinator users.
   *
   * The two roles are kept STRICTLY separate: teaching a subject and running a
   * wing are different jobs, and a teacher should not see colleagues' exams just
   * because she also coordinates. So the page shows exactly one scope at a time
   * and `activeViewRole` decides which.
   *
   * `activeViewRole` defaults to `viewRoles[0]`, so teacher+coordinator lands
   * on "teacher" and admin+teacher on "admin". The user changes it from the
   * compact RoleSwitcher in the app bar, which is reachable from this page like
   * every other; this page used to render a second switcher for the same state
   * and no longer does (one control per fact).
   *
   * A pure coordinator has nothing to switch and always gets coordinator scope;
   * the old `isCoordinator && !isTeacher && !isSchoolAdmin` test failed for
   * dual-role staff and silently pinned them to the teacher list.
   *
   * The same applies to an admin who teaches: the app-bar switcher offers Admin
   * and Teacher, so `isSchoolAdminView` above is a VIEW, not a fixed fact about
   * the account.
   */
  const canSwitchScope = hasDualRole && !isManagingAsAdmin;
  const isCoordinatorScope =
    !isSchoolAdminView &&
    !!roleInfo?.isCoordinator &&
    (!canSwitchScope || activeViewRole === "coordinator");

  const { isFeatureEnabled } = useInstitutionFeatures();
  // Same role-derived destination the Homework page header button uses:
  // admin/coordinator manage the institution's targets, everyone else sees
  // their own.
  const targetsPathForRole =
    isSchoolAdminView || isCoordinatorScope ? "/school/teacher-targets" : "/teacher/my-targets";

  const exams = useMemo<ExamRow[]>(() => {
    if (isSchoolAdminView) return schoolExams || [];
    // useCoordinatorExams is itself "own exams UNION wing exams", so coordinator
    // scope never loses her own work. Anything she teaches OUTSIDE her wing
    // belongs to the teacher view and stays reachable there.
    if (isCoordinatorScope) return coordinatorExams || [];
    return teacherExams || [];
  }, [isSchoolAdminView, isCoordinatorScope, schoolExams, coordinatorExams, teacherExams]);

  const isLoading = isSchoolAdminView
    ? schoolLoading
    : isCoordinatorScope
      // The wing class ids resolve first; without this the page would flash an
      // empty list before the coordinator query is even enabled.
      ? coordLoading || coordClassesLoading
      : teacherLoading;

  // A failed fetch must render as an error, never as "No exams found" (§6).
  const isError = isSchoolAdminView
    ? schoolError
    : isCoordinatorScope
      ? coordError
      : teacherError;

  const retryExams = useCallback(() => {
    if (isSchoolAdminView) {
      void refetchSchoolExams();
      return;
    }
    if (isCoordinatorScope) {
      void refetchCoordinatorExams();
      return;
    }
    void refetchTeacherExams();
  }, [
    isSchoolAdminView,
    isCoordinatorScope,
    refetchSchoolExams,
    refetchTeacherExams,
    refetchCoordinatorExams,
  ]);

  // Server-aggregated per-exam result counts, powering the "Result Pending" /
  // "Result Published" filters (exams.status can't express either — see
  // matchesStatusFilter).
  const examIds = useMemo(() => exams.map((e) => e.id), [exams]);
  const { data: resultProgress } = useExamResultProgress(examIds);

  const deleteExam = useDeleteExam();
  const duplicateExam = useDuplicateExamDraft();
  const [search, setSearch] = useState("");

  // Filters live in the URL, not in component state. They used to be useState,
  // so opening an exam and coming back unmounted the page and silently reset
  // every filter. Keeping them in the query string means browser back restores
  // the exact list the teacher was looking at (and the view is shareable).
  const [searchParams, setSearchParams] = useSearchParams();
  const statusFilter = searchParams.get("status") || "all";
  const modeFilter = (searchParams.get("mode") || "all") as ExamModeFilter;
  const sortBy = searchParams.get("sort") || "date_desc";

  const setFilterParams = useCallback(
    (patch: Record<string, string | undefined>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          Object.entries(patch).forEach(([key, value]) => {
            // Defaults stay out of the URL so a plain /exams link is clean.
            if (!value || value === "all" || value === "date_desc") next.delete(key);
            else next.set(key, value);
          });
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setStatusFilter = useCallback(
    (v: string) => setFilterParams({ status: v }),
    [setFilterParams],
  );
  const setModeFilter = useCallback(
    (v: ExamModeFilter) => setFilterParams({ mode: v }),
    [setFilterParams],
  );
  const setSortBy = useCallback(
    (v: string) => setFilterParams({ sort: v }),
    [setFilterParams],
  );

  // Pending filter state for FilterSheet (applied only on "Apply")
  const [pendingModeFilter, setPendingModeFilter] = useState<ExamModeFilter>("all");
  const [pendingSortBy, setPendingSortBy] = useState<string>("date_desc");

  // Keep the sheet's draft values in step with whatever the URL currently says,
  // so reopening Filters shows the active selection rather than stale defaults.
  useEffect(() => {
    setPendingModeFilter(modeFilter);
    setPendingSortBy(sortBy);
  }, [modeFilter, sortBy]);

  // When switching to Offline mode, widen status so published offline exams are visible
  const handleModeChange = (v: ExamModeFilter) => {
    if (v === "offline" && statusFilter === "draft") {
      setFilterParams({ mode: v, status: "all" });
    } else {
      setFilterParams({ mode: v });
    }
  };
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [viewExamId, setViewExamId] = useState<string | null>(null);
  const [offlineExamId, setOfflineExamId] = useState<string | null>(null);
  const [previewExam, setPreviewExam] = useState<{ id: string; title: string; mode: "online" | "offline" } | null>(null);
  const [examToDelete, setExamToDelete] = useState<{ id: string; title: string } | null>(null);
  const [showDrafts, setShowDrafts] = useState(false);

  // Admin-only filter state
  const [classFilter, setClassFilter] = useState<string>("all");
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  const [dateRange, setDateRange] = useState<DateRange | undefined>();
  // Pending admin filter state for FilterSheet
  const [pendingClassFilter, setPendingClassFilter] = useState<string>("all");
  const [pendingTeacherFilter, setPendingTeacherFilter] = useState<string>("all");
  const [pendingDateRange, setPendingDateRange] = useState<DateRange | undefined>();

  // Drafts data for compact strip
  const { data: drafts = [] } = useExamDrafts();
  const draftCount = drafts.length;
  const hasDrafts = draftCount > 0;

  // Derive filter options from exam data (admin only). Academic-year rollover
  // creates a fresh classes row per (name, section) each year and old exams
  // stay linked to the previous year's row, so options are merged by display
  // identity and the filter matches ANY of the underlying class ids.
  // Class / teacher / date filters were admin-only. A coordinator's list is
  // wing-wide (hundreds of exams spanning every teacher in the wing), so it
  // needs the same narrowing. These derive from the already-loaded rows, so
  // widening them costs no extra queries.
  const showScopeFilters = isSchoolAdminView || isCoordinatorScope;

  const classOptions = useMemo(() => {
    if (!showScopeFilters) return [];
    const map = new Map<string, { name: string; section: string | null; ids: Set<string> }>();
    exams.forEach((exam: ExamRow) => {
      exam.exam_classes?.forEach((ec) => {
        if (ec.class_id && ec.classes?.name) {
          const key = `${ec.classes.name}|${ec.classes.section || ""}`;
          const existing = map.get(key);
          if (existing) {
            existing.ids.add(ec.class_id);
          } else {
            map.set(key, {
              name: ec.classes.name,
              section: ec.classes.section || null,
              ids: new Set([ec.class_id]),
            });
          }
        }
      });
    });
    return Array.from(map.entries())
      .map(([key, cls]) => ({
        key,
        name: cls.name,
        section: cls.section,
        displayName: formatClassName(cls.name, cls.section),
        ids: Array.from(cls.ids),
      }))
      .sort(compareClassRows);
  }, [exams, showScopeFilters]);

  // Class ids covered by the current class filter (null = no filtering)
  const classFilterIds = useMemo(() => {
    if (classFilter === "all") return null;
    const opt = classOptions.find((c) => c.key === classFilter);
    return opt ? new Set(opt.ids) : null;
  }, [classFilter, classOptions]);

  const teacherOptions = useMemo(() => {
    if (!showScopeFilters) return [];
    const map = new Map<string, string>();
    exams.forEach((exam: ExamRow) => {
      if (exam.created_by && exam.profiles?.full_name) {
        map.set(exam.created_by, exam.profiles.full_name);
      }
    });
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [exams, showScopeFilters]);

  // Active filter counts
  const sheetFilterCount = (modeFilter !== "all" ? 1 : 0) + (sortBy !== "date_desc" ? 1 : 0) +
    (showScopeFilters ? (
      (classFilter !== "all" ? 1 : 0) +
      (teacherFilter !== "all" ? 1 : 0) +
      (dateRange?.from ? 1 : 0)
    ) : 0);

  const activeFilterCount = (statusFilter !== "all" ? 1 : 0) + sheetFilterCount;

  const resetFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setModeFilter("all");
    setSortBy("date_desc");
    setClassFilter("all");
    setTeacherFilter("all");
    setDateRange(undefined);
    // Also reset pending
    setPendingModeFilter("all");
    setPendingSortBy("date_desc");
    setPendingClassFilter("all");
    setPendingTeacherFilter("all");
    setPendingDateRange(undefined);
  };

  const applyPendingFilters = () => {
    setModeFilter(pendingModeFilter);
    setSortBy(pendingSortBy);
    if (pendingModeFilter === "offline" && statusFilter === "draft") {
      setStatusFilter("all");
    }
    if (showScopeFilters) {
      setClassFilter(pendingClassFilter);
      setTeacherFilter(pendingTeacherFilter);
      setDateRange(pendingDateRange);
    }
  };

  const resetPendingFilters = () => {
    setPendingModeFilter("all");
    setPendingSortBy("date_desc");
    setPendingClassFilter("all");
    setPendingTeacherFilter("all");
    setPendingDateRange(undefined);
  };

  const handleCreateExam = () => navigate("/exams/create");

  const filteredExams = exams?.filter((exam: ExamRow) => {
    const matchesSearch = exam.title.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = matchesStatusFilter(
      exam,
      statusFilter,
      resultProgress?.[exam.id],
    );
    const isOfflineExam = exam.exam_mode === "offline" || !!exam.is_offline;
    const isHybridExam = exam.exam_mode === "hybrid" && !isOfflineExam;
    // "Online" used to mean "anything not offline", which quietly swept hybrid
    // exams into the Online list. Each mode now matches only itself.
    const matchesMode =
      modeFilter === "all" ||
      (modeFilter === "offline"
        ? isOfflineExam
        : modeFilter === "hybrid"
          ? isHybridExam
          : !isOfflineExam && !isHybridExam);

    // Admin-only filters
    const matchesClass =
      !classFilterIds ||
      exam.exam_classes?.some((ec) => ec.class_id && classFilterIds.has(ec.class_id));
    const matchesTeacher = teacherFilter === "all" || exam.created_by === teacherFilter;
    const matchesDateRange = !dateRange?.from || (
      exam.scheduled_date &&
      new Date(exam.scheduled_date) >= dateRange.from &&
      (!dateRange.to || new Date(exam.scheduled_date) <= dateRange.to)
    );

    return matchesSearch && matchesStatus && matchesMode && matchesClass && matchesTeacher && matchesDateRange;
  })?.sort((a: ExamRow, b: ExamRow) => {
    switch (sortBy) {
      case "date_desc":
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      case "date_asc":
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      case "title_asc":
        return a.title.localeCompare(b.title);
      case "title_desc":
        return b.title.localeCompare(a.title);
      case "marks_desc":
        return (b.total_marks || 0) - (a.total_marks || 0);
      default:
        return 0;
    }
  }) || [];

  const getPageTitle = () => {
    if (isSchoolAdminView) return "All Exams";
    if (isCoordinatorScope) return "Class Exams";
    return "My Exams";
  };

  const getPageDescription = () => {
    if (isSchoolAdminView) return "View and manage all exams in your institution";
    if (isCoordinatorScope) return "Every exam across the classes in your wing";
    if (canSwitchScope) {
      return viewRoles.includes("admin")
        ? "Exams you teach. Switch to Admin for the whole institution."
        : "Exams you teach. Switch to Coordinator for your wing.";
    }
    return "Manage your exams and assessments";
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  const isEmptyState = filteredExams.length === 0;

  return (
    <PageShell
      fab={
        <MobileFab
          label="Create Exam"
          icon={<Plus className="h-6 w-6" />}
          onClick={handleCreateExam}
          hideWhen={isEmptyState}
        />
      }
    >
      <PageHeader
        icon={<FileText className="h-5 w-5" />}
        title={getPageTitle()}
        subtitle={getPageDescription()}
        extras={
          isFeatureEnabled("teacher_targets") ? (
            <TargetsHeaderButton to={targetsPathForRole} />
          ) : undefined
        }
        primaryAction={{
          label: "Create Exam",
          icon: <Plus className="h-4 w-4" />,
          onClick: handleCreateExam,
        }}
      />

      {/* Compact draft strip */}
      {hasDrafts && (
        <div className="surface-card frosted-shadow rounded-2xl p-4 flex items-center justify-between gap-3 mt-2">
          <div className="space-y-0.5 min-w-0">
            <p className="text-sm font-medium text-ink-900">
              {draftCount} draft{draftCount === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-ink-500">Pick up where you left off.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowDrafts((v) => !v)}
            className="shrink-0 text-sm font-medium text-brand-primary"
          >
            {showDrafts ? "Hide ↑" : "View →"}
          </button>
        </div>
      )}

      {/* Expanded drafts list */}
      {showDrafts && (
        <div className="mt-3">
          <DraftsTab />
        </div>
      )}

      {/* Search + filters */}
      <div className="mt-4 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search exams..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl"
          />
        </div>

        <FilterRow activeCount={activeFilterCount} onClear={resetFilters}>
          {/* Status inline chip */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium border bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm w-auto min-w-[140px] gap-2",
                statusFilter !== "all"
                  ? "border-brand-primary text-brand-primary"
                  : "border-surface-stroke text-ink-700",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Exams</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="live">Live Exam</SelectItem>
              <SelectItem value="result_pending">Result Pending</SelectItem>
              <SelectItem value="result_published">Result Published</SelectItem>
            </SelectContent>
          </Select>

          {/* FilterSheet for mode, sort and admin filters */}
          <FilterSheet
            activeCount={sheetFilterCount}
            onApply={applyPendingFilters}
            onReset={resetPendingFilters}
          >
            <div className="space-y-4">
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink-700">Mode</p>
                <Select
                  value={pendingModeFilter}
                  onValueChange={(v) => setPendingModeFilter(v as ExamModeFilter)}
                >
                  <SelectTrigger className="h-10 rounded-xl w-full">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="online">Online</SelectItem>
                    <SelectItem value="offline">Offline</SelectItem>
                    <SelectItem value="hybrid">Hybrid</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <p className="text-sm font-medium text-ink-700">Sort by</p>
                <Select value={pendingSortBy} onValueChange={setPendingSortBy}>
                  <SelectTrigger className="h-10 rounded-xl w-full">
                    <SelectValue placeholder="Newest First" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date_desc">Newest First</SelectItem>
                    <SelectItem value="date_asc">Oldest First</SelectItem>
                    <SelectItem value="title_asc">Title A-Z</SelectItem>
                    <SelectItem value="title_desc">Title Z-A</SelectItem>
                    <SelectItem value="marks_desc">Highest Marks</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {showScopeFilters && (
                <>
                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-ink-700">Class</p>
                    <Select value={pendingClassFilter} onValueChange={setPendingClassFilter}>
                      <SelectTrigger className="h-10 rounded-xl w-full">
                        <SelectValue placeholder="All Classes" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Classes</SelectItem>
                        {classOptions.map((c) => (
                          <SelectItem key={c.key} value={c.key}>{c.displayName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-ink-700">Teacher</p>
                    <Select value={pendingTeacherFilter} onValueChange={setPendingTeacherFilter}>
                      <SelectTrigger className="h-10 rounded-xl w-full">
                        <SelectValue placeholder="All Teachers" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Teachers</SelectItem>
                        {teacherOptions.map((t) => (
                          <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-sm font-medium text-ink-700">Date range</p>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal h-10 rounded-xl",
                            FIELD_FILL,
                            !pendingDateRange?.from && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {pendingDateRange?.from ? (
                            pendingDateRange.to ? (
                              `${format(pendingDateRange.from, "MMM d")} - ${format(pendingDateRange.to, "MMM d")}`
                            ) : (
                              format(pendingDateRange.from, "MMM d, yyyy")
                            )
                          ) : (
                            "Pick a range"
                          )}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="range"
                          selected={pendingDateRange}
                          onSelect={setPendingDateRange}
                          numberOfMonths={2}
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </>
              )}
            </div>
          </FilterSheet>

          {/* View mode toggle */}
          <div className="ml-auto flex items-center gap-1 rounded-full border border-surface-stroke bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm p-0.5 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              aria-pressed={viewMode === "grid"}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full",
                viewMode === "grid" ? "bg-brand-primary text-white" : "text-ink-500",
              )}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("list")}
              aria-pressed={viewMode === "list"}
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-full",
                viewMode === "list" ? "bg-brand-primary text-white" : "text-ink-500",
              )}
            >
              <ListIcon className="h-4 w-4" />
            </button>
          </div>
        </FilterRow>
      </div>

      {/* Body. The error branch MUST come before the empty state: a failed
          query resolving to zero rows would otherwise read as "you have no
          exams" (§6). */}
      {isError ? (
        <div className="mt-4 surface-card frosted-shadow rounded-2xl">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            reason="error"
            title="Couldn't load exams"
            description="Something went wrong fetching your exam list. Please try again."
            action={{
              label: "Retry",
              icon: <RefreshCw className="h-4 w-4" />,
              onClick: retryExams,
            }}
          />
        </div>
      ) : isEmptyState ? (
        <div className="mt-4 surface-card frosted-shadow rounded-2xl" data-sticky-bottom>
          <EmptyState
            icon={<FileText className="h-7 w-7" />}
            title="No exams found"
            description={
              search || statusFilter !== "all"
                ? "Try adjusting your filters."
                : isCoordinatorScope
                  // Coordinator scope is empty when the wing has no classes
                  // mapped yet, which is a setup gap, not a prompt to author an
                  // exam. Say so instead of "create your first exam".
                  ? "No exams in your wing's classes yet. If this looks wrong, ask your school admin to check your wing's class mappings."
                  : "Create your first exam to get started."
            }
            action={
              !search && statusFilter === "all" && !isCoordinatorScope
                ? {
                    label: "Create Exam",
                    icon: <Plus className="h-4 w-4" />,
                    onClick: handleCreateExam,
                  }
                : undefined
            }
          />
        </div>
      ) : viewMode === "grid" ? (
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filteredExams.map((exam: ExamRow) => {
            const isOffline = exam.exam_mode === "offline" || !!exam.is_offline;
            const handleCardClick = () => {
              if (isOffline) setOfflineExamId(exam.id);
              else if (exam.status === "draft") setViewExamId(exam.id);
              else if (exam.exam_mode === "hybrid") navigate(`/evaluations/hybrid?examId=${exam.id}`);
              else navigate(`/exams/${exam.id}/results`);
            };
            const subjectName = exam.exam_subjects?.[0]?.universal_subjects?.name;
            const className = exam.exam_classes?.[0]?.classes?.name
              ? formatClassName(exam.exam_classes[0].classes.name ?? "", exam.exam_classes[0].classes.section ?? null)
              : null;
            const extraClasses = (exam.exam_classes?.length || 0) - 1;
            const accent = statusAccent(exam.status, isOffline);

            return (
              <Card
                key={exam.id}
                className="group relative flex flex-col overflow-hidden cursor-pointer border-border/70 shadow-none transition-all hover:border-primary/40 hover:shadow-md"
                onClick={handleCardClick}
              >
                {/* Accent header strip */}
                <div className={cn("relative px-4 py-2.5", accent.bg)}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-1.5">
                      <ExamStatusBadge status={exam.status} />
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-medium capitalize px-1.5 py-0 h-5 bg-white/70 backdrop-blur-sm",
                          isOffline && "border-[#fa920e]/40 text-[#fa920e]"
                        )}
                      >
                        {exam.exam_mode}
                      </Badge>
                      {exam.is_results_only && (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-medium px-1.5 py-0 h-5 bg-white/70 backdrop-blur-sm border-[#fa920e]/40 text-[#fa920e]"
                        >
                          Results upload
                        </Badge>
                      )}
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 -mr-1 -mt-1 text-foreground/60 hover:bg-white/60 hover:text-foreground"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenuItem onClick={() => setViewExamId(exam.id)}>
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            setPreviewExam({
                              id: exam.id,
                              title: exam.title,
                              mode: isOffline ? "offline" : "online",
                            })
                          }
                        >
                          <FileSearch className="h-4 w-4 mr-2" />
                          Preview
                        </DropdownMenuItem>
                        {exam.status === "draft" && (
                          isSchoolAdminView ||
                          exam.created_by === user?.id ||
                          (teacherAssignments?.flat || []).some((a: TeacherAssignment) => {
                            const examClassIds = (exam.exam_classes || []).map((ec) => ec.class_id);
                            const examSubjectIds = (exam.exam_subjects || []).map((es) => es.subject_id);
                            return examClassIds.includes(a.classId) && a.subjectId && examSubjectIds.includes(a.subjectId);
                          })
                        ) && (
                          <DropdownMenuItem onClick={() => navigate(`/exams/edit/${exam.id}`)}>
                            <Edit3 className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        )}
                        {exam.exam_mode === "offline" && exam.status !== "draft" && (
                          <DownloadQuestionPaperButton examId={exam.id} examTitle={exam.title} variant="menuItem" />
                        )}
                        {/* Available for every exam — draft, published, live,
                            awaiting results or already published. The copy is
                            always created as a fresh draft. */}
                        <DropdownMenuItem
                          disabled={duplicateExam.isPending}
                          onClick={() => duplicateExam.mutate(exam.id)}
                        >
                          <Copy className="h-4 w-4 mr-2" />
                          Create Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => setExamToDelete({ id: exam.id, title: exam.title })}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* Title block */}
                <div className="flex-1 px-4 pt-4 pb-4">
                  <h3 className="text-base font-semibold text-foreground line-clamp-2 leading-snug">
                    {exam.title}
                  </h3>
                  {subjectName && (
                    <p className="mt-1 text-xs text-muted-foreground truncate">{subjectName}</p>
                  )}

                  <div className="mt-4 space-y-2 text-xs text-muted-foreground">
                    {className && (
                      <div className="flex items-center gap-1.5">
                        <GraduationCap className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">
                          {className}
                          {extraClasses > 0 && ` +${extraClasses}`}
                        </span>
                      </div>
                    )}
                    {exam.profiles?.full_name && (
                      <div className="flex items-center gap-1.5">
                        <User className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{exam.profiles.full_name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-border/60 bg-muted/30 px-4 py-2 text-[11px] text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    <span>{exam.scheduled_date ? format(new Date(exam.scheduled_date), "MMM d, yyyy") : "Not scheduled"}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {exam.total_marks != null && (
                      <span className="tabular-nums"><span className="font-semibold text-foreground">{exam.total_marks}</span> marks</span>
                    )}
                    {exam.duration_minutes != null && (
                      <span className="flex items-center gap-1 tabular-nums">
                        <Clock className="h-3 w-3" />
                        {exam.duration_minutes}m
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <ul className="mt-4 list-none p-0 space-y-2">
          {filteredExams.map((exam: ExamRow) => {
            const isOffline = exam.exam_mode === "offline" || !!exam.is_offline;
            const subjectName = exam.exam_subjects
              ?.map((es) => es.universal_subjects?.name)
              .filter(Boolean)
              .join(", ");
            const classText = exam.exam_classes
              ?.map((ec) => ec.classes ? formatClassName(ec.classes.name ?? "", ec.classes.section ?? null) : null)
              .filter(Boolean)
              .join(", ");

            const handleRowClick = () => {
              if (isOffline) setOfflineExamId(exam.id);
              else if (exam.status === "draft") setViewExamId(exam.id);
              else if (exam.exam_mode === "hybrid") navigate(`/evaluations/hybrid?examId=${exam.id}`);
              else navigate(`/exams/${exam.id}/results`);
            };

            return (
              <ListRow
                key={exam.id}
                as="li"
                leading={
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                    <FileText className="h-5 w-5" />
                  </span>
                }
                title={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{exam.title}</span>
                    <ExamStatusBadge status={exam.status} />
                  </span>
                }
                subtitle={[subjectName, classText].filter(Boolean).join(" · ") || undefined}
                onClick={handleRowClick}
                trailing={
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => setViewExamId(exam.id)}>
                        <Eye className="h-4 w-4 mr-2" />
                        View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() =>
                          setPreviewExam({
                            id: exam.id,
                            title: exam.title,
                            mode: isOffline ? "offline" : "online",
                          })
                        }
                      >
                        <FileSearch className="h-4 w-4 mr-2" />
                        Preview
                      </DropdownMenuItem>
                      {exam.status === "draft" && (
                        isSchoolAdminView ||
                        exam.created_by === user?.id ||
                        (teacherAssignments?.flat || []).some((a: TeacherAssignment) => {
                          const examClassIds = (exam.exam_classes || []).map((ec) => ec.class_id);
                          const examSubjectIds = (exam.exam_subjects || []).map((es) => es.subject_id);
                          return examClassIds.includes(a.classId) && a.subjectId && examSubjectIds.includes(a.subjectId);
                        })
                      ) && (
                        <DropdownMenuItem onClick={() => navigate(`/exams/edit/${exam.id}`)}>
                          <Edit3 className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                      )}
                      {exam.exam_mode === "offline" && exam.status !== "draft" && (
                        <DownloadQuestionPaperButton examId={exam.id} examTitle={exam.title} variant="menuItem" />
                      )}
                      {/* Same as the grid view — every exam can be duplicated,
                          and the copy always lands as a fresh draft. */}
                      <DropdownMenuItem
                        disabled={duplicateExam.isPending}
                        onClick={() => duplicateExam.mutate(exam.id)}
                      >
                        <Copy className="h-4 w-4 mr-2" />
                        Create Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => setExamToDelete({ id: exam.id, title: exam.title })}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            );
          })}
        </ul>
      )}

      {/* Exam Details Sheet */}
      <ExamDetailsSheet
        open={!!viewExamId}
        onOpenChange={(open) => !open && setViewExamId(null)}
        examId={viewExamId}
      />

      {/* Exam Preview Dialog */}
      <ExamPreviewDialog
        open={!!previewExam}
        onOpenChange={(open) => !open && setPreviewExam(null)}
        examId={previewExam?.id ?? null}
        examTitle={previewExam?.title}
        examMode={previewExam?.mode}
      />

      {/* Offline marks entry sheet — shared with the dashboard's exam-trend
          chart so both surfaces open the identical window. Results-only
          ("Already Created") exams must be reopened in the section-marks
          pipeline they were authored in, which is what ExamCreationFlow does. */}
      <OfflineMarksSheet
        examId={offlineExamId}
        isResultsOnly={!!exams.find((e) => e.id === offlineExamId)?.is_results_only}
        onOpenChange={(open) => !open && setOfflineExamId(null)}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!examToDelete} onOpenChange={(open) => !open && setExamToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Exam</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{examToDelete?.title}"? This action cannot be undone
              and will remove all questions, sections, and associated data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (examToDelete) {
                  deleteExam.mutate(examToDelete.id);
                  setExamToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteExam.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

/**
 * Status filter matching.
 *
 * `exams.status` alone can't express what teachers actually ask for:
 *  - 'active' is never written by any code path (0 rows on prod), so the old
 *    "Active" option always returned nothing. "Live Exam" is therefore computed
 *    from the schedule — published and inside its window right now.
 *  - 'completed' is not the same as "results are out": 320 exams sitting at
 *    'published' already had published results, so a status-based
 *    "Result Published" would have hidden almost all of them. Both result
 *    buckets read final_results.is_published via the get_exam_result_progress
 *    aggregate instead.
 */
function matchesStatusFilter(
  exam: ExamRow,
  filter: string,
  progress: ExamResultProgress | undefined,
): boolean {
  if (filter === "all") return true;

  const isPublished = exam.status === "published" || exam.status === "active";

  switch (filter) {
    case "live": {
      if (!isPublished || !exam.start_time) return false;
      const now = Date.now();
      const start = new Date(exam.start_time).getTime();
      const end = exam.end_time ? new Date(exam.end_time).getTime() : null;
      return now >= start && (end === null || now <= end);
    }
    case "result_published":
      return (progress?.publishedResults ?? 0) > 0;
    case "result_pending":
      // Someone has actually sat the exam, and nothing has been released yet.
      return (
        (progress?.submittedAttempts ?? 0) > 0 &&
        (progress?.publishedResults ?? 0) === 0
      );
    // Legacy ?status= values from older links.
    case "active":
      return exam.status === "active";
    case "completed":
      return exam.status === "completed";
    default:
      return exam.status === filter;
  }
}

const STATUS_LABELS: Record<string, string> = {
  all: "All Exams",
  draft: "Draft",
  published: "Published",
  live: "Live Exam",
  result_pending: "Result Pending",
  result_published: "Result Published",
  // Legacy values still reachable via the ?status= URL param.
  active: "Live Exam",
  completed: "Result Published",
};

// Each band has a dark: variant: without it the light tint stayed in dark
// mode and the outline "Online" / "Draft" chips on it were white on white
// (2026-09-18 phone audit).
function statusAccent(status: string, isOffline: boolean) {
  if (isOffline) {
    return {
      bg: "bg-gradient-to-br from-amber-100 via-orange-50 to-rose-50 dark:from-amber-500/20 dark:via-orange-500/10 dark:to-rose-500/10",
    };
  }
  switch (status) {
    case "published":
      return {
        bg: "bg-gradient-to-br from-sky-100 via-sky-50 to-indigo-50 dark:from-sky-500/20 dark:via-sky-500/10 dark:to-indigo-500/10",
      };
    case "active":
      return {
        bg: "bg-gradient-to-br from-emerald-100 via-teal-50 to-cyan-50 dark:from-emerald-500/20 dark:via-teal-500/10 dark:to-cyan-500/10",
      };
    case "completed":
      return {
        bg: "bg-gradient-to-br from-violet-100 via-purple-50 to-fuchsia-50 dark:from-violet-500/20 dark:via-purple-500/10 dark:to-fuchsia-500/10",
      };
    case "draft":
    default:
      return {
        bg: "bg-gradient-to-br from-slate-100 via-slate-50 to-zinc-50 dark:from-slate-500/20 dark:via-slate-500/10 dark:to-zinc-500/10",
      };
  }
}

function ExamStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    draft: "bg-muted text-muted-foreground border-border",
    published: "bg-blue-50 text-blue-700 border-blue-200",
    active: "bg-emerald-50 text-emerald-700 border-emerald-200",
    completed: "bg-muted text-muted-foreground border-border",
    archived: "bg-muted text-muted-foreground border-border",
  };

  return (
    <Badge
      variant="outline"
      className={`capitalize text-[10px] font-medium px-1.5 py-0 h-5 ${colors[status] || colors.draft}`}
    >
      {status}
    </Badge>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="space-y-6 py-4">
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-2xl" />
          <div>
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-56 mt-2" />
          </div>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-24 rounded-full" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-48 rounded-2xl" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}
