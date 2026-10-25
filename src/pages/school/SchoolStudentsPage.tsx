import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Users,
  Plus,
  Search,
  MoreHorizontal,
  Upload,
  Layers,
  Key,
  RefreshCw,
  Trash2,
  X,
  ClipboardList,
  GraduationCap,
  FileSpreadsheet,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useRef, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { translateError } from "@/lib/errorMessages";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsStudentManager } from "@/hooks/useIsStudentManager";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { Navigate, useNavigate } from "react-router-dom";
import { AddUserDialog } from "@/components/admin/AddUserDialog";
import { BulkUploadStudentsDialog } from "@/components/school/BulkUploadStudentsDialog";
import { BulkUpdateStudentsDialog } from "@/components/school/BulkUpdateStudentsDialog";
import { UpdateRollNumberSheet, type RollNumberSheetSection } from "@/components/school/UpdateRollNumberSheet";
import { UpdateClassSectionSheet } from "@/components/school/UpdateClassSectionSheet";
import { UpdateOptionalSubjectSheet } from "@/components/school/UpdateOptionalSubjectSheet";
import { ViewUserSheet } from "@/components/admin/ViewUserSheet";
import { AssignStudentClassDialog } from "@/components/school/AssignStudentClassDialog";
import { EditStudentPasswordDialog } from "@/components/admin/EditStudentPasswordDialog";
import { BulkAssignTaskDialog } from "@/components/shared/BulkAssignTaskDialog";
import { PromoteStudentsDialog } from "@/components/school/PromoteStudentsDialog";
import { BulkPromoteUploadDialog } from "@/components/school/BulkPromoteUploadDialog";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { useWings } from "@/hooks/useWings";
import { AccessRestrictedBanner } from "@/components/shared/AccessDenied";
import { formatNumber } from "@/lib/formatNumber";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { ClayStatTile, ListRow, EmptyState } from "@/components/shared/surfaces";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** Rows fetched per page. The roster used to load in full (up to 50k rows)
 * into the browser; it is now server-paginated in PAGE_SIZE chunks (§23). */
const PAGE_SIZE = 40;

/** Minimal shape held in the bulk-selection map — enough to drive the
 * delete/assign-task dialogs without re-fetching. Selections can span pages
 * (via "Select all N matching"), so we keep names alongside ids rather than
 * re-deriving them from the current page. */
type SelectedStudent = { id: string; full_name: string };

/** Columns the roster search box matches against. Defined once so the
 * paginated query and "select all N matching" can never drift apart.
 * `term` must already be stripped of PostgREST or()-syntax metacharacters. */
const buildSearchOr = (term: string) =>
  `full_name.ilike.%${term}%,email.ilike.%${term}%,admission_number.ilike.%${term}%`;

interface StudentRow {
  id: string;
  full_name: string;
  email: string;
  admission_number: string | null;
  is_active: boolean | null;
  avatar_path: string | null;
  class_assignments:
    | Array<{
        class_id: string;
        classes:
          | { name: string | null; section: string | null }
          | { name: string | null; section: string | null }[]
          | null;
      }>
    | null;
}

export default function SchoolStudentsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [wingFilter, setWingFilter] = useState<string>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [viewUserOpen, setViewUserOpen] = useState(false);
  const [assignClassOpen, setAssignClassOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<{ id: string; full_name: string; email: string; currentClassId?: string } | null>(null);
  const [deleteUser, setDeleteUser] = useState<{ id: string; full_name: string } | null>(null);
  const [selectedStudents, setSelectedStudents] = useState<Map<string, SelectedStudent>>(new Map());
  const [selectingAll, setSelectingAll] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkTaskOpen, setBulkTaskOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [bulkPromoteOpen, setBulkPromoteOpen] = useState(false);
  const [rollSheetOpen, setRollSheetOpen] = useState(false);
  // Set when the roll sheet is opened from a student's profile.
  const [rollSheetSection, setRollSheetSection] = useState<RollNumberSheetSection | null>(null);
  const [classSectionSheetOpen, setClassSectionSheetOpen] = useState(false);
  const [optionalSubjectSheetOpen, setOptionalSubjectSheetOpen] = useState(false);

  // Hidden trigger refs for trigger-only dialogs (Phase 5 Task 17 pattern)
  const addStudentTriggerRef = useRef<HTMLButtonElement>(null);
  const bulkUploadTriggerRef = useRef<HTMLButtonElement>(null);
  const bulkUpdateTriggerRef = useRef<HTMLButtonElement>(null);

  const { data: roleInfo } = useUserRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const navigate = useNavigate();

  // Determine effective role - one hat at a time, never a union.
  // "admin" maps back to the concrete admin role so every downstream
  // comparison against "school_admin" / "super_school_admin" is unchanged.
  const rawEffectiveRole = hasDualRole
    ? (activeViewRole === "admin" ? roleInfo?.primaryRole : activeViewRole)
    : roleInfo?.primaryRole;

  // Per-user override grant (student_manager_overrides): a named teacher
  // given institution-wide student management without a role change.
  // Resolving it to "school_admin" HERE — at the single source every
  // downstream check reads — keeps the ~30 isEffectiveAdmin /
  // isEffectiveCoordinator branches on this page consistent instead of
  // hand-editing each. Server-side RLS enforces the same grant.
  const { isStudentManager } = useIsStudentManager();
  const effectiveRole = isStudentManager ? "school_admin" : rawEffectiveRole;

  const isEffectiveCoordinator = effectiveRole === "coordinator";
  const isEffectiveAdmin = effectiveRole === "super_admin" || effectiveRole === "school_admin" || effectiveRole === "super_school_admin";
  const canBulkTask = isEffectiveAdmin || isEffectiveCoordinator;
  // Coordinators delete students too (2026-10-05). admin-operations enforces
  // the wing: a coordinator may only delete a student in one of their own
  // wing's classes, which is exactly the list this page shows them.
  const canDeleteStudents = isEffectiveAdmin || isEffectiveCoordinator;

  // A dual-role user wearing the teacher hat here: a coordinator or admin who
  // also teaches and flipped the app-bar switcher on this page. This page only
  // knows two scopes, the wing and the whole institution, and the teacher hat
  // used to fall through to the whole institution: a coordinator scoped to the
  // 578 students of her wing saw all 1,545 the moment she switched to Teacher.
  // A teacher's roster is subject-scoped (§25) and lives on its own page, so
  // hand over to it below and fetch nothing here meanwhile.
  const isTeacherHat = effectiveRole === "teacher";

  const {
    classIds: coordinatorClassIds,
    isLoading: coordLoading,
    isError: coordFailed,
  } = useCoordinatorClasses();

  // Debounce the search box so we fire one server query after typing settles
  // (not one per keystroke), and snap back to page 1 for the new result set.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  // Wings filter — admins only. Coordinators are already scoped to their
  // assigned classes via `coordinatorClassIds`, so a wings dropdown for them
  // would be redundant. Declared up here so the students query below can scope
  // the roster by the selected wing's classes server-side.
  const { data: wings } = useWings(
    isEffectiveCoordinator || isTeacherHat ? null : roleInfo?.institutionId ?? null,
  );

  // wing -> class id map, used to (a) restrict the visible classes in the
  // class filter when a wing is selected, and (b) scope the student query by
  // membership in any class belonging to that wing.
  const { data: wingClassMappings } = useQuery({
    queryKey: ["wing-class-mappings-all", roleInfo?.institutionId],
    queryFn: async () => {
      if (!roleInfo?.institutionId || !wings || wings.length === 0) return [];
      const wingIds = wings.map((w) => w.id);
      const { data, error } = await supabase
        .from("wing_class_mappings")
        .select("wing_id, class_id")
        .in("wing_id", wingIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!roleInfo?.institutionId && !isEffectiveCoordinator && (wings?.length ?? 0) > 0,
  });

  // Class ids the selected wing spans — resolved before the students query so
  // it can scope the roster server-side (a wing = a set of classes).
  const selectedWingClassIds =
    wingFilter === "all" || !wingClassMappings
      ? null
      : wingClassMappings.filter((m) => m.wing_id === wingFilter).map((m) => m.class_id);

  // Coordinators are scoped to their assigned classes; admins see the whole
  // institution. When a class or wing filter is active we constrain the roster
  // to those classes. Only when one of these applies do we need the
  // class_assignments embed to be an INNER join (filter parents via EXISTS).
  const constrainClassIds: string[] | null =
    classFilter !== "all"
      ? [classFilter]
      : selectedWingClassIds && selectedWingClassIds.length > 0
      ? selectedWingClassIds
      : isEffectiveCoordinator
      ? coordinatorClassIds
      : null;

  // Builds the profiles select for a student-roster page. `inner` filters the
  // parent to students who have a matching class assignment; the left-join
  // variant keeps unassigned students visible (they render "Not assigned").
  const buildRosterSelect = (inner: boolean) => `
    id, full_name, email, admission_number, is_active, avatar_path,
    user_roles!user_roles_user_id_fkey!inner(role),
    class_assignments!class_assignments_user_id_fkey${inner ? "!inner" : ""}(
      class_id,
      classes(name, section)
    )
  `;

  const { data: studentsPage, isLoading, isFetching, isPlaceholderData, isError, error, refetch } = useQuery({
    queryKey: [
      "school-students",
      roleInfo?.institutionId,
      isEffectiveCoordinator,
      coordinatorClassIds,
      page,
      debouncedSearch,
      classFilter,
      wingFilter,
    ],
    queryFn: async (): Promise<{ rows: StudentRow[]; total: number }> => {
      if (!roleInfo?.institutionId) return { rows: [], total: 0 };

      const from = (page - 1) * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const inner = !!constrainClassIds;

      let query = supabase
        .from("profiles")
        .select(buildRosterSelect(inner), { count: "exact" })
        .eq("institution_id", roleInfo.institutionId)
        .eq("user_roles.role", "student")
        .order("full_name")
        .range(from, to);

      if (constrainClassIds) {
        query = query.in("class_assignments.class_id", constrainClassIds);
      }
      if (debouncedSearch) {
        // Strip PostgREST or()-syntax metacharacters so a name with a comma or
        // paren can't break the filter (or inject conditions).
        const term = debouncedSearch.replace(/[,()%*\\]/g, "").trim();
        if (term) query = query.or(buildSearchOr(term));
      }

      const { data, error: qErr, count } = await query;
      if (qErr) throw qErr;
      return { rows: (data ?? []) as unknown as StudentRow[], total: count ?? 0 };
    },
    enabled: !!roleInfo?.institutionId && !isTeacherHat && (!isEffectiveCoordinator || !coordLoading),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const pageRows = studentsPage?.rows ?? [];
  const matchingTotal = studentsPage?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(matchingTotal / PAGE_SIZE));
  const hasActiveFilter = !!debouncedSearch || classFilter !== "all" || wingFilter !== "all";

  // If the result set shrinks (e.g. after a bulk delete) so the current page no
  // longer exists, snap back to the last valid page instead of showing empty.
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  // Stable institution-wide student count for the "Total Students" tile —
  // a server-side head count that does NOT change as filters/search narrow
  // the list below it (§23: never .length a fetched array to count).
  //
  // Institution-wide, this MUST be `institution_student_ids` — the one
  // canonical roster every other surface counts (see the
  // command-center-dashboards skill). Counting `profiles` here instead is what
  // put "Total Students 253" on this page next to "252" on the Command Center:
  // a student account with no class assignment was inflating only this tile.
  // Such accounts still appear in the list below, marked "Not assigned", so
  // they stay fixable rather than becoming invisible.
  const { data: totalStudentCount } = useQuery({
    queryKey: ["school-students-count", roleInfo?.institutionId, isEffectiveCoordinator, coordinatorClassIds],
    queryFn: async () => {
      if (!roleInfo?.institutionId) return 0;
      // Unconditional for a coordinator: see the note on `constrainClassIds`.
      // Zero classes means zero students, never the institution-wide count.
      if (isEffectiveCoordinator && coordinatorClassIds.length === 0) return 0;
      if (!isEffectiveCoordinator) {
        const { data, error: rErr } = await supabase.rpc("institution_student_count", {
          _institution: roleInfo.institutionId,
        });
        if (rErr) throw rErr;
        return data ?? 0;
      }
      // Coordinator scope: already class-based (inner join), so it agrees with
      // the canonical roster narrowed to their wing's classes.
      const { count, error: cErr } = await supabase
        .from("profiles")
        .select(
          "id, user_roles!user_roles_user_id_fkey!inner(role), class_assignments!class_assignments_user_id_fkey!inner(class_id)",
          { count: "exact", head: true },
        )
        .eq("institution_id", roleInfo.institutionId)
        .eq("user_roles.role", "student")
        .in("class_assignments.class_id", coordinatorClassIds);
      if (cErr) throw cErr;
      return count ?? 0;
    },
    enabled: !!roleInfo?.institutionId && !isTeacherHat && (!isEffectiveCoordinator || !coordLoading),
    staleTime: 60_000,
  });

  const { data: classes } = useQuery({
    queryKey: ["school-classes", roleInfo?.institutionId, isEffectiveCoordinator, coordinatorClassIds],
    queryFn: async () => {
      if (!roleInfo?.institutionId) return [];

      if (isEffectiveCoordinator) {
        if (coordinatorClassIds.length === 0) return [];
        const { data, error } = await supabase
          .from("classes")
          .select("id, name, section")
          .in("id", coordinatorClassIds)
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
      }

      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", roleInfo.institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!roleInfo?.institutionId && !isTeacherHat && (!isEffectiveCoordinator || !coordLoading),
  });

  // Class IDs scoped to the selected wing (used only to narrow the class
  // dropdown; the roster itself is scoped server-side via constrainClassIds).
  const wingClassIds = (() => {
    if (wingFilter === "all" || !wingClassMappings) return null;
    return new Set(
      wingClassMappings
        .filter((m) => m.wing_id === wingFilter)
        .map((m) => m.class_id),
    );
  })();

  // Class options the user can pick from, narrowed to the selected wing.
  const filteredClasses = wingClassIds
    ? classes?.filter((c) => wingClassIds.has(c.id))
    : classes;

  // Reset to page 1 whenever a filter changes so the user isn't stranded on a
  // now-out-of-range page number.
  const handleClassFilterChange = (v: string) => {
    setClassFilter(v);
    setPage(1);
  };
  const handleWingFilterChange = (v: string) => {
    setWingFilter(v);
    // A class selected from another wing shouldn't persist once the wing scope
    // narrows or widens.
    setClassFilter("all");
    setPage(1);
  };

  const handleViewProfile = (userId: string) => {
    setSelectedUserId(userId);
    setViewUserOpen(true);
  };

  const handleAssignToClass = (student: { id: string; full_name: string; email: string; class_assignments?: Array<{ class_id: string }> }) => {
    const currentClassId = student.class_assignments?.[0]?.class_id;
    setSelectedStudent({
      id: student.id,
      full_name: student.full_name,
      email: student.email,
      currentClassId,
    });
    setAssignClassOpen(true);
  };

  const handleResetPassword = (student: { id: string; full_name: string; email: string }) => {
    setSelectedStudent({
      id: student.id,
      full_name: student.full_name,
      email: student.email,
    });
    setPasswordDialogOpen(true);
  };

  const handleViewResults = (studentId: string) => {
    // Was /reports?studentId=, which ReportsPage never read: the admin landed on
    // an empty institution-wide Exam Reports tab with no student context. This is
    // the staff view of one student's record, and it authorises inside its RPC.
    navigate(`/school/student/${studentId}`);
  };

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return invokeAdminOperation({ action: "delete_user", data: { userId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      queryClient.invalidateQueries({ queryKey: ["school-students-count"] });
      toast({ title: "Student Deleted", description: "The student has been permanently removed." });
      setDeleteUser(null);
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't delete this student.", context: "deleteStudent" }),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async (userIds: string[]) => {
      const results: Array<{ userId: string; success?: boolean; error?: string }> = [];
      for (const userId of userIds) {
        try {
          await invokeAdminOperation({ action: "delete_user", data: { userId } });
          results.push({ userId, success: true });
        } catch (err) {
          results.push({ userId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      return results;
    },
    onSuccess: (results) => {
      const successCount = results.filter(r => r.success).length;
      const failures = results.filter(r => r.error);
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      queryClient.invalidateQueries({ queryKey: ["school-students-count"] });
      toast({
        title: `${successCount} student(s) deleted`,
        // One blocker usually explains every failure, so name the first reason.
        description: failures.length > 0
          ? `${failures.length} couldn't be deleted. ${translateError(new Error(failures[0].error)).title}`
          : undefined,
        variant: failures.length > 0 ? "destructive" : "default",
      });
      setSelectedStudents(new Map());
      setBulkDeleteOpen(false);
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Bulk delete failed.", context: "bulkDeleteStudents" }),
  });

  // Bulk selection helpers. Selection is a Map keyed by id so it survives
  // paging (a selected student on page 1 stays selected on page 3) and carries
  // the name needed by the delete / assign-task dialogs.
  const selectedCount = selectedStudents.size;
  const pageAllSelected =
    pageRows.length > 0 && pageRows.every((s) => selectedStudents.has(s.id));

  const toggleStudentSelection = (student: { id: string; full_name: string }) => {
    setSelectedStudents((prev) => {
      const next = new Map(prev);
      if (next.has(student.id)) next.delete(student.id);
      else next.set(student.id, { id: student.id, full_name: student.full_name });
      return next;
    });
  };

  // The header checkbox selects/clears just the current page's rows.
  const toggleSelectPage = () => {
    setSelectedStudents((prev) => {
      const next = new Map(prev);
      if (pageAllSelected) {
        for (const s of pageRows) next.delete(s.id);
      } else {
        for (const s of pageRows) next.set(s.id, { id: s.id, full_name: s.full_name });
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedStudents(new Map());

  // "Select all N matching" — fetches just id + name for every row matching the
  // active filters/search (bounded, two columns) so bulk actions can target the
  // whole result set, not only the visible page.
  const selectAllMatching = async () => {
    if (!roleInfo?.institutionId) return;
    setSelectingAll(true);
    try {
      const inner = !!constrainClassIds;
      let q = supabase
        .from("profiles")
        .select(
          `id, full_name, user_roles!user_roles_user_id_fkey!inner(role), class_assignments!class_assignments_user_id_fkey${inner ? "!inner" : ""}(class_id)`,
        )
        .eq("institution_id", roleInfo.institutionId)
        .eq("user_roles.role", "student")
        .order("full_name")
        .range(0, 9999);
      if (constrainClassIds) q = q.in("class_assignments.class_id", constrainClassIds);
      if (debouncedSearch) {
        const term = debouncedSearch.replace(/[,()%*\\]/g, "").trim();
        if (term) q = q.or(buildSearchOr(term));
      }
      const { data, error: selErr } = await q;
      if (selErr) throw selErr;
      const next = new Map<string, SelectedStudent>();
      for (const s of (data ?? []) as Array<{ id: string; full_name: string }>) {
        next.set(s.id, { id: s.id, full_name: s.full_name });
      }
      setSelectedStudents(next);
    } catch (err) {
      toastError(err, { fallback: "Couldn't select all students.", context: "selectAllStudents" });
    } finally {
      setSelectingAll(false);
    }
  };

  const getSelectedStudentsForBulk = () => [...selectedStudents.values()];

  // Header action handlers
  const handleAddStudent = () => addStudentTriggerRef.current?.click();
  const handleBulkUpload = () => bulkUploadTriggerRef.current?.click();
  const handleBulkUpdate = () => bulkUpdateTriggerRef.current?.click();
  const handleAssignTaskAll = async () => {
    // "Assign Task to All" targets every matching student, so pull the full
    // matching set before opening the bulk dialog.
    await selectAllMatching();
    setBulkTaskOpen(true);
  };
  const handlePromoteStudents = () => setPromoteOpen(true);
  const handleBulkPromote = () => setBulkPromoteOpen(true);

  // Teacher hat: this page has nothing correctly scoped to show. The teacher
  // roster page does, and it hands back here under the coordinator hat.
  if (isTeacherHat) {
    return <Navigate to="/teacher/students" replace />;
  }

  if (isLoading) {
    return <PageSkeleton />;
  }

  const hasNoAccess = isEffectiveCoordinator && coordinatorClassIds.length === 0;
  const showCheckboxes = isEffectiveAdmin || isEffectiveCoordinator;

  return (
    <PageShell
      fab={
        !hasNoAccess ? (
          <MobileFab
            label="Add Student"
            icon={<Plus className="h-6 w-6" />}
            onClick={handleAddStudent}
          />
        ) : undefined
      }
    >
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title="Students"
        subtitle={
          isEffectiveCoordinator
            ? "Manage students in your assigned classes"
            : "Manage your school's students"
        }
        collapseSecondary
        secondaryMenuLabel="Bulk Actions"
        primaryAction={
          !hasNoAccess
            ? {
                label: "Add Student",
                icon: <Plus className="h-4 w-4" />,
                onClick: handleAddStudent,
              }
            : undefined
        }
        secondaryActions={
          !hasNoAccess
            ? [
                ...(canBulkTask && roleInfo?.institutionId
                  ? [{ label: "Assign Task to All", icon: <ClipboardList className="h-4 w-4" />, onClick: handleAssignTaskAll }]
                  : []),
                { label: "Bulk Upload", icon: <Upload className="h-4 w-4" />, onClick: handleBulkUpload },
                ...(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin || isEffectiveCoordinator
                  ? [{ label: "Update Details", icon: <RefreshCw className="h-4 w-4" />, onClick: handleBulkUpdate }]
                  : []),
                ...(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin
                  ? [
                      { label: "Promote Students", icon: <GraduationCap className="h-4 w-4" />, onClick: handlePromoteStudents },
                      { label: "Bulk Promote (CSV)", icon: <FileSpreadsheet className="h-4 w-4" />, onClick: handleBulkPromote },
                    ]
                  : []),
              ]
            : []
        }
      />

      {/* The dashboard's clay tiles, as on the other Manage Users tabs
          (Naman, 2026-10-07: "do for teachers and students also"). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <ClayStatTile label="Total students" value={formatNumber(totalStudentCount || 0)} icon={<Users />} tone="teal" />
        <ClayStatTile label="Classes" value={formatNumber(classes?.length || 0)} icon={<Layers />} tone="violet" />
      </div>

      {/* Coordinator access banner */}
      {isEffectiveCoordinator && !hasNoAccess && (
        <div className="mt-4">
          <AccessRestrictedBanner
            message={`Showing students from ${coordinatorClassIds.length} assigned class${coordinatorClassIds.length > 1 ? 'es' : ''}`}
          />
        </div>
      )}

      {/* Bulk Selection Bar */}
      {selectedCount > 0 && (
        <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 border-brand-primary/20 bg-brand-primary/5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-sm">
                {formatNumber(selectedCount)} selected
              </Badge>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {canBulkTask && roleInfo?.institutionId && (
                <Button variant="outline" size="sm" onClick={() => setBulkTaskOpen(true)}>
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Bulk Assign Task
                </Button>
              )}
              {canDeleteStudents && (
                <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Search + filter row */}
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, or admission no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 rounded-xl pl-9 border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] shadow-card placeholder:text-ink-500 focus-visible:ring-brand-primary/40"
          />
        </div>
        {/* Wings + Classes filters — share a single row on mobile so they
            don't stack into two rows. `sm:contents` makes the wrapper
            transparent on desktop so the two selects flow into the
            parent flex normally (preserves the existing inline layout).
            On mobile each select is `flex-1` so they split the row width
            evenly. */}
        <div className="flex flex-row gap-2 sm:contents">
          {/* Wings filter — sits BEFORE classes filter. Hidden for
              coordinators (already scoped by their wing assignments) and
              for institutions with no wings configured. */}
          {!isEffectiveCoordinator && (wings?.length ?? 0) > 0 && (
            <Select value={wingFilter} onValueChange={handleWingFilterChange}>
              <SelectTrigger className="h-11 rounded-xl flex-1 min-w-0 sm:flex-none sm:w-48">
                <SelectValue placeholder="All Wings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Wings</SelectItem>
                {wings?.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={classFilter} onValueChange={handleClassFilterChange}>
            <SelectTrigger className="h-11 rounded-xl flex-1 min-w-0 sm:flex-none sm:w-48">
              <SelectValue placeholder="All Classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Classes</SelectItem>
              {filteredClasses?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {formatClassName(c.name, c.section)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {(classFilter !== "all" || wingFilter !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setClassFilter("all");
              setWingFilter("all");
              setPage(1);
            }}
            className="self-start sm:self-auto"
          >
            <X className="h-4 w-4 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Students List */}
      <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink-900">
            Students
            {matchingTotal > 0 && (
              <span className="ml-1.5 text-sm font-normal text-ink-500">
                ({formatNumber(matchingTotal)})
              </span>
            )}
          </h2>
          {showCheckboxes && pageRows.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={pageAllSelected}
                onCheckedChange={toggleSelectPage}
                aria-label="Select all students on this page"
              />
              <span className="text-xs text-ink-500">Select page</span>
            </div>
          )}
        </div>

        {/* Select-all-across-pages affordance (Gmail-style) — appears once the
            whole visible page is selected and more matching rows exist. */}
        {showCheckboxes && pageAllSelected && selectedCount < matchingTotal && (
          <div className="flex flex-wrap items-center justify-center gap-1.5 rounded-xl bg-brand-primary/5 px-3 py-2 text-center text-sm text-ink-600">
            <span>All {formatNumber(pageRows.length)} on this page selected.</span>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-brand-primary"
              onClick={selectAllMatching}
              disabled={selectingAll}
            >
              {selectingAll ? "Selecting…" : `Select all ${formatNumber(matchingTotal)} matching`}
            </Button>
          </div>
        )}

        {isError || (isEffectiveCoordinator && coordFailed) ? (
          // §6: render the error state BEFORE the empty state — a failed fetch
          // must never read as "no students".
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-ink-800">Couldn&apos;t load students</p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-ink-500">
              {error instanceof Error ? error.message : "Something went wrong. Please try again."}
            </p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Try again
            </Button>
          </div>
        ) : matchingTotal === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={hasActiveFilter ? "No matching students" : "No students yet"}
            description={
              hasActiveFilter
                ? "Try a different search term or clear the filters."
                : isEffectiveCoordinator
                ? "Students assigned to your classes will appear here."
                : "Add students to start tracking attendance and performance."
            }
            action={
              hasActiveFilter
                ? {
                    label: "Clear filters",
                    icon: <X className="h-4 w-4" />,
                    onClick: () => {
                      setSearch("");
                      setClassFilter("all");
                      setWingFilter("all");
                      setPage(1);
                    },
                  }
                : !hasNoAccess
                ? {
                    label: "Add Student",
                    icon: <Plus className="h-4 w-4" />,
                    onClick: handleAddStudent,
                  }
                : undefined
            }
          />
        ) : (() => {
          // Inline render — same row markup is reused by both the flat
          // (admin) view and the split (coordinator) view.
          const renderStudentRow = (student: StudentRow) => {
            const studentAssignments = student.class_assignments || [];
            const rawClass = studentAssignments[0]?.classes;
            const studentClass = Array.isArray(rawClass) ? rawClass[0] : rawClass;
            const isSelected = selectedStudents.has(student.id);
            return (
              <ListRow
                key={student.id}
                as="li"
                className={isSelected ? "ring-2 ring-brand-primary/40" : undefined}
                leading={
                  showCheckboxes ? (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleStudentSelection(student)}
                        aria-label={`Select ${student.full_name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <UserAvatar
                        name={student.full_name}
                        email={student.email}
                        avatarPath={student.avatar_path}
                        className="h-10 w-10"
                      />
                    </div>
                  ) : (
                    <UserAvatar
                      name={student.full_name}
                      email={student.email}
                      avatarPath={student.avatar_path}
                      className="h-10 w-10"
                    />
                  )
                }
                title={
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{student.full_name}</span>
                    {studentClass ? (
                      <Badge variant="outline" className="text-xs">
                        {formatClassName(studentClass.name || "", studentClass.section)}
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Not assigned
                      </Badge>
                    )}
                    {!student.is_active && (
                      <Badge variant="secondary" className="text-xs">
                        Inactive
                      </Badge>
                    )}
                  </span>
                }
                subtitle={
                  <span className="truncate">
                    {student.admission_number
                      ? `${student.admission_number} · ${student.email}`
                      : student.email}
                  </span>
                }
                onClick={() => handleViewProfile(student.id)}
                trailing={
                  // stopPropagation on the content prevents menu-item
                  // clicks from bubbling through React's tree to the
                  // ListRow's outer onClick (handleViewProfile), which
                  // would otherwise paint the View Profile sheet on top
                  // of whatever the menu item actually opened.
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
                    <DropdownMenuContent
                      align="end"
                      className="bg-popover z-50"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenuItem onClick={() => handleViewProfile(student.id)}>
                        View Profile
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleAssignToClass(student)}>
                        Assign to Class
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleResetPassword(student)}>
                        <Key className="h-4 w-4 mr-2" />
                        Reset Password
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleViewResults(student.id)}>
                        View Results
                      </DropdownMenuItem>
                      {canDeleteStudents && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteUser({ id: student.id, full_name: student.full_name })}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Student
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
              />
            );
          };

          return (
            <ul
              aria-busy={isFetching}
              className={`list-none p-0 space-y-2 ${
                isFetching && isPlaceholderData
                  ? "pointer-events-none opacity-60 transition-opacity"
                  : ""
              }`}
            >
              {pageRows.map(renderStudentRow)}
            </ul>
          );
        })()}

        {!isError && matchingTotal > 0 && (
          <StudentsPaginationBar
            page={page}
            totalPages={totalPages}
            total={matchingTotal}
            pageSize={PAGE_SIZE}
            currentCount={pageRows.length}
            onPageChange={setPage}
          />
        )}
      </div>

      {/* Hidden triggers for trigger-only dialogs (Phase 5 Task 17 pattern) */}
      {!hasNoAccess && (
        <div className="sr-only" aria-hidden>
          <BulkUploadStudentsDialog
            institutionId={roleInfo?.institutionId || ""}
            coordinatorClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
            trigger={
              <button
                ref={bulkUploadTriggerRef}
                type="button"
                tabIndex={-1}
                aria-hidden
              />
            }
          />
          {(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin || isEffectiveCoordinator) && (
            <BulkUpdateStudentsDialog
              institutionId={roleInfo?.institutionId || ""}
              onOpenRollNumberPicker={() => setRollSheetOpen(true)}
              onOpenClassSectionPicker={() => setClassSectionSheetOpen(true)}
              onOpenOptionalSubjectPicker={() => setOptionalSubjectSheetOpen(true)}
              trigger={
                <button
                  ref={bulkUpdateTriggerRef}
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                />
              }
            />
          )}
          <AddUserDialog
            defaultInstitutionId={roleInfo?.institutionId}
            defaultRole="student"
            allowedRoles={["student"]}
            coordinatorClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
            trigger={
              <button
                ref={addStudentTriggerRef}
                type="button"
                tabIndex={-1}
                aria-hidden
              />
            }
          />
        </div>
      )}

      {/* Dialogs and Sheets */}
      <ViewUserSheet
        open={viewUserOpen}
        onOpenChange={setViewUserOpen}
        userId={selectedUserId}
        // Same audience as the Update Details menu that opens this sheet.
        onUpdateRollNumbers={
          roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin || isEffectiveCoordinator
            ? (section) => {
                setRollSheetSection(section);
                setRollSheetOpen(true);
              }
            : undefined
        }
      />

      {roleInfo?.institutionId && (
        <AssignStudentClassDialog
          open={assignClassOpen}
          onOpenChange={setAssignClassOpen}
          student={selectedStudent}
          institutionId={roleInfo.institutionId}
          coordinatorClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
        />
      )}

      <EditStudentPasswordDialog
        open={passwordDialogOpen}
        onOpenChange={setPasswordDialogOpen}
        student={selectedStudent}
      />

      {/* Single Delete Dialog */}
      <AlertDialog
        open={!!deleteUser}
        onOpenChange={(open) => {
          if (!open && !deleteUserMutation.isPending) setDeleteUser(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteUser?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the student's account, so they can no longer sign in. Their
              exam attempts, results, marks, attendance, homework submissions and badges are deleted
              with it and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUserMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteUserMutation.isPending}
              onClick={(e) => {
                // Keep the dialog open until the delete settles, so "Deleting..."
                // is visible and a second click can't fire a second request.
                e.preventDefault();
                if (deleteUser && !deleteUserMutation.isPending) {
                  deleteUserMutation.mutate(deleteUser.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteUserMutation.isPending ? "Deleting..." : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Dialog */}
      <AlertDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!bulkDeleteMutation.isPending) setBulkDeleteOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {formatNumber(selectedCount)} student(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>{formatNumber(selectedCount)} student account(s)</strong>,
              so they can no longer sign in. Their exam attempts, results, marks, attendance, homework
              submissions and badges are deleted with them and cannot be recovered.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkDeleteMutation.isPending}
              onClick={(e) => {
                // Same single-flight rule as the single delete: stay open, one run only.
                e.preventDefault();
                if (!bulkDeleteMutation.isPending) {
                  bulkDeleteMutation.mutate([...selectedStudents.keys()]);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : `Delete ${formatNumber(selectedCount)} student(s)`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Task Dialog */}
      {roleInfo?.institutionId && (
        <BulkAssignTaskDialog
          open={bulkTaskOpen}
          onOpenChange={(open) => {
            setBulkTaskOpen(open);
            if (!open) clearSelection();
          }}
          assignees={getSelectedStudentsForBulk()}
          institutionId={roleInfo.institutionId}
        />
      )}

      {/* Promote Students Dialog */}
      {roleInfo?.institutionId && (
        <PromoteStudentsDialog
          open={promoteOpen}
          onOpenChange={setPromoteOpen}
          institutionId={roleInfo.institutionId}
        />
      )}

      {/* Bulk Promote Upload Dialog */}
      {roleInfo?.institutionId && (
        <BulkPromoteUploadDialog
          open={bulkPromoteOpen}
          onOpenChange={setBulkPromoteOpen}
          institutionId={roleInfo.institutionId}
        />
      )}

      {/* Update Roll Number Sheet */}
      <UpdateRollNumberSheet
        open={rollSheetOpen}
        onOpenChange={(next) => {
          setRollSheetOpen(next);
          if (!next) setRollSheetSection(null);
        }}
        institutionId={roleInfo?.institutionId ?? null}
        allowedClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
        initialSection={rollSheetSection}
      />

      {/* Update Class & Section Sheet */}
      <UpdateClassSectionSheet
        open={classSectionSheetOpen}
        onOpenChange={setClassSectionSheetOpen}
        institutionId={roleInfo?.institutionId ?? null}
        allowedClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
      />

      {/* Update Optional Subjects Sheet */}
      <UpdateOptionalSubjectSheet
        open={optionalSubjectSheetOpen}
        onOpenChange={setOptionalSubjectSheetOpen}
        institutionId={roleInfo?.institutionId ?? null}
        allowedClassIds={isEffectiveCoordinator ? coordinatorClassIds : undefined}
      />
    </PageShell>
  );
}

/** Professional pager: "Showing X–Y of Z" + windowed numbered pages (desktop)
 * / compact "page N of M" (mobile), with Previous / Next. Matches the admin
 * table pagers used elsewhere (Question Bank, Users). */
function StudentsPaginationBar({
  page,
  totalPages,
  total,
  pageSize,
  currentCount,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  currentCount: number;
  onPageChange: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + currentCount;

  // Windowed page list: 1 … (p-1) p (p+1) … last, collapsing runs to an ellipsis.
  const pageItems: Array<number | "ellipsis"> = [];
  const left = Math.max(2, page - 1);
  const right = Math.min(totalPages - 1, page + 1);
  pageItems.push(1);
  if (left > 2) pageItems.push("ellipsis");
  for (let n = left; n <= right; n++) pageItems.push(n);
  if (right < totalPages - 1) pageItems.push("ellipsis");
  if (totalPages > 1) pageItems.push(totalPages);

  return (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-ink-500 sm:text-sm">
        Showing{" "}
        <span className="font-medium text-ink-700">
          {formatNumber(from)}–{formatNumber(to)}
        </span>{" "}
        of <span className="font-medium text-ink-700">{formatNumber(total)}</span> students
      </p>

      <div className="flex items-center justify-center gap-1">
        <Button
          variant="outline"
          size="sm"
          className="h-9 px-2.5"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Previous</span>
        </Button>

        {/* Numbered pages — desktop only */}
        <div className="hidden items-center gap-1 sm:flex">
          {pageItems.map((item, i) =>
            item === "ellipsis" ? (
              <span key={`ellipsis-${i}`} className="px-1.5 text-ink-400" aria-hidden>
                …
              </span>
            ) : (
              <Button
                key={item}
                variant={item === page ? "default" : "outline"}
                size="sm"
                className="h-9 min-w-[2.25rem] px-2"
                onClick={() => onPageChange(item)}
                aria-label={`Page ${item}`}
                aria-current={item === page ? "page" : undefined}
              >
                {item}
              </Button>
            ),
          )}
        </div>

        {/* Compact indicator — mobile only */}
        <span className="px-2 text-sm text-ink-600 sm:hidden">
          {formatNumber(page)} / {formatNumber(totalPages)}
        </span>

        <Button
          variant="outline"
          size="sm"
          className="h-9 px-2.5"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <span className="mr-1 hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="space-y-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-64 mt-2" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </PageShell>
  );
}
