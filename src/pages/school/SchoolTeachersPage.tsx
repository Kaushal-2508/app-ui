import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Users,
  GraduationCap,
  Plus,
  Search,
  MoreHorizontal,
  BookOpen,
  Layers,
  UserCog,
  X,
  Trash2,
  ClipboardList,
  FileDown,
  ListChecks,
  Check,
  Activity,
  Loader2,
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
import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useIsStaffManager } from "@/hooks/useIsStaffManager";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useWings } from "@/hooks/useWings";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AddUserDialog } from "@/components/admin/AddUserDialog";
import { BulkUploadTeachersButton } from "@/components/school/BulkUploadTeachersButton";
import { ViewUserSheet } from "@/components/admin/ViewUserSheet";
import { AssignTeacherClassSubjectDialog } from "@/components/school/AssignTeacherClassSubjectDialog";
import { BulkAssignTeachersDialog } from "@/components/school/BulkAssignTeachersDialog";
import { PromoteToCoordinatorDialog } from "@/components/school/PromoteToCoordinatorDialog";
import { BulkAssignTaskDialog } from "@/components/shared/BulkAssignTaskDialog";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { EditTeacherDialog } from "@/components/school/EditTeacherDialog";
import { GoogleEmailSheet } from "@/components/ptm/GoogleEmailSheet";
import { usePTMSchemaReady } from "@/hooks/ptm";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { PTM_FEATURE_ID } from "@/lib/ptm";
import { formatNumber } from "@/lib/formatNumber";
import { formatClassName } from "@/lib/utils";
import { toastError } from "@/lib/toast";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { sortClassRows } from "@/lib/classSort";
import { useTeacherActivityExport } from "@/hooks/useTeacherActivityExport";
import * as XLSX from "xlsx";
import { saveBlob } from "@/lib/native";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { ClayStatTile, ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterChip } from "@/components/shared/nav";
import { MobileSheet } from "@/components/shared/sheets";

export default function SchoolTeachersPage() {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [viewUserOpen, setViewUserOpen] = useState(false);
  const [assignClassesOpen, setAssignClassesOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{ id: string; full_name: string } | null>(null);
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<Set<string>>(new Set());
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [promoteToCoordinatorOpen, setPromoteToCoordinatorOpen] = useState(false);
  const [classFilter, setClassFilter] = useState<Set<string>>(new Set());
  const [wingFilter, setWingFilter] = useState<string>("all");
  const [deleteUser, setDeleteUser] = useState<{ id: string; full_name: string } | null>(null);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkTaskOpen, setBulkTaskOpen] = useState(false);
  const [editTeacher, setEditTeacher] = useState<{ id: string; full_name: string; email?: string; is_active?: boolean } | null>(null);
  // The Google account a teacher joins online PTMs with (admins set it for
  // a teacher who has not). Only once the online PTM migration is live.
  const [googleFor, setGoogleFor] = useState<{ id: string; full_name: string } | null>(null);
  const ptmProbe = usePTMSchemaReady();
  const { isFeatureEnabled: isSchoolFeatureEnabled } = useInstitutionFeatures();

  // Ref to programmatically trigger the AddUserDialog hidden button
  const addTeacherTriggerRef = useRef<HTMLButtonElement>(null);
  const handleAddTeacher = () => addTeacherTriggerRef.current?.click();

  const { data: roleInfo } = useUserRole();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const { institutionId: effectiveInstitutionId } = useEffectiveInstitution();
  const navigate = useNavigate();

  // Determine effective role - one hat at a time, never a union.
  // "admin" maps back to the concrete admin role so every downstream
  // comparison against "school_admin" / "super_school_admin" is unchanged.
  const effectiveRole = hasDualRole
    ? (activeViewRole === "admin" ? roleInfo?.primaryRole : activeViewRole)
    : roleInfo?.primaryRole;

  // Per-user override grant (staff_manager_overrides): a named teacher given
  // the non-destructive "manage teaching staff" rights of this tab. Treated
  // like a coordinator for the SOFT actions only (see canMutateTeacherAccounts).
  const { isStaffManager } = useIsStaffManager();

  const isEffectiveCoordinator = effectiveRole === "coordinator";
  const isEffectiveAdmin = effectiveRole === "super_admin" || effectiveRole === "school_admin" || effectiveRole === "super_school_admin";
  // Coordinators have the same teacher-management authority as school admins
  // (view all, edit, delete, assign classes/subjects, bulk ops). Kept separate
  // from isEffectiveAdmin because promotion flows (Make Coordinator) still gate
  // on the admin roles only.
  //
  // Two tiers of authority on this page:
  //   * canManageTeachers        — SOFT ops: view, assign/bulk-assign classes
  //     & subjects, edit basic details, export, assign tasks.
  //   * canMutateTeacherAccounts — HARD ops: Add Teacher, Bulk Upload, Delete,
  //     and email/password edits (create/permanently delete auth accounts).
  //
  // Staff-manager-override holders now hold BOTH tiers (owner decision
  // 2026-07-25, widening the original non-destructive-only grant). The
  // admin-operations edge fn mirrors this server-side and additionally pins
  // the override to TEACHER targets only — it can never create or delete an
  // admin or coordinator. "Make Coordinator" is NOT part of this and stays
  // admin-only via its own isSchoolAdmin/isSuperAdmin gate further below.
  const canManageTeachers = isEffectiveAdmin || isEffectiveCoordinator || isStaffManager;
  // set_google_email for another user is admin-only on the server.
  const canSetGoogleEmail =
    ptmProbe.onlineReady &&
    isSchoolFeatureEnabled(PTM_FEATURE_ID) &&
    !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin);
  const canMutateTeacherAccounts = isEffectiveAdmin || isEffectiveCoordinator || isStaffManager;

  // Use effective institution ID (handles Super Admin managing an institution)
  const institutionId = effectiveInstitutionId;

  const { data: teachers, isLoading } = useQuery({
    queryKey: ["school-teachers", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      // Fetch all teachers in the institution. Coordinators are treated the
      // same as admins here — they manage the whole teaching staff, not just
      // their wing.
      const { data: teacherRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .eq("institution_id", roleInfo.institutionId)
        .in("role", ["teacher", "coordinator"]);

      if (rolesError) throw rolesError;
      if (!teacherRoles || teacherRoles.length === 0) return [];

      // Group roles by user
      const userRolesMap = new Map<string, string[]>();
      teacherRoles.forEach(r => {
        const roles = userRolesMap.get(r.user_id) || [];
        roles.push(r.role);
        userRolesMap.set(r.user_id, roles);
      });

      // Get only users who have teacher role
      const teacherUserIds = [...userRolesMap.entries()]
        .filter(([, roles]) => roles.includes("teacher"))
        .map(([userId]) => userId);

      if (teacherUserIds.length === 0) return [];

      // Then fetch profiles for these users with their class assignments
      const { data, error } = await supabase
        .from("profiles")
        .select(`
          *,
          class_assignments!class_assignments_user_id_fkey(
            class_id,
            subject_id,
            classes(name, section),
            universal_subjects(name)
          )
        `)
        .in("id", teacherUserIds)
        .order("full_name");

      if (error) throw error;

      // Add coordinator flag
      return (data || []).map(teacher => ({
        ...teacher,
        isCoordinator: userRolesMap.get(teacher.id)?.includes("coordinator") || false,
      }));
    },
    enabled: !!roleInfo?.institutionId,
  });

  // Fetch classes for filter dropdown
  const { data: allClasses } = useQuery({
    queryKey: ["institution-classes-for-filter", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId,
  });

  // Wings filter — visible for everyone with access to this page (admins
  // and coordinators alike, since this page treats coordinators as admins
  // for the teaching staff view per the comment on the teachers query).
  const { data: wings } = useWings(institutionId ?? null);

  // wing -> class id map: drives both the "narrow class options to this
  // wing" UX and the teacher-membership filter below.
  const { data: wingClassMappings } = useQuery({
    queryKey: ["wing-class-mappings-all", institutionId],
    queryFn: async () => {
      if (!institutionId || !wings || wings.length === 0) return [];
      const wingIds = wings.map((w) => w.id);
      const { data, error } = await supabase
        .from("wing_class_mappings")
        .select("wing_id, class_id")
        .in("wing_id", wingIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!institutionId && (wings?.length ?? 0) > 0,
  });

  // Class IDs that belong to the selected wing (null = no wing scoping).
  const wingClassIds = (() => {
    if (wingFilter === "all" || !wingClassMappings) return null;
    return new Set(
      wingClassMappings
        .filter((m) => m.wing_id === wingFilter)
        .map((m) => m.class_id),
    );
  })();

  // Class options shown in the dropdown — narrowed when a wing is picked.
  const filteredClasses = wingClassIds
    ? allClasses?.filter((c) => wingClassIds.has(c.id))
    : allClasses;

  // Filter teachers by search and class filter
  const filteredTeachers = teachers?.filter((teacher) => {
    const matchesSearch = teacher.full_name.toLowerCase().includes(search.toLowerCase()) ||
      teacher.email.toLowerCase().includes(search.toLowerCase());
    if (!matchesSearch) return false;

    const teacherClassIds: string[] = teacher.class_assignments?.map(
      (ca: { class_id: string }) => ca.class_id,
    ) || [];

    // Wing scoping: teacher must be assigned to at least one class in the
    // selected wing. Admins/coordinators with no wing filter see all.
    if (wingClassIds) {
      const inWing = teacherClassIds.some((cid) => wingClassIds.has(cid));
      if (!inWing) return false;
    }

    if (classFilter.size > 0) {
      const hasMatch = teacherClassIds.some((cid) => classFilter.has(cid));
      if (!hasMatch) return false;
    }

    return true;
  });

  // Coordinator-only — split the filtered teacher list into two groups:
  // those assigned to a class in the coordinator's wings ("Your Wings"),
  // and everyone else ("Other Teachers"). Admins / school-admins skip
  // this and see the flat list as before.
  const { classIds: coordinatorWingClassIds } = useCoordinatorClasses();
  const { wingTeachers, otherTeachers } = useMemo(() => {
    if (
      !isEffectiveCoordinator ||
      coordinatorWingClassIds.length === 0 ||
      !filteredTeachers
    ) {
      return {
        wingTeachers: filteredTeachers ?? [],
        otherTeachers: [] as NonNullable<typeof filteredTeachers>,
      };
    }
    const wingClassIdSet = new Set(coordinatorWingClassIds);
    const wing: NonNullable<typeof filteredTeachers> = [];
    const other: NonNullable<typeof filteredTeachers> = [];
    for (const t of filteredTeachers) {
      const ids: string[] =
        (t.class_assignments as Array<{ class_id: string }> | undefined)?.map(
          (ca) => ca.class_id,
        ) ?? [];
      if (ids.some((cid) => wingClassIdSet.has(cid))) wing.push(t);
      else other.push(t);
    }
    return { wingTeachers: wing, otherTeachers: other };
  }, [filteredTeachers, isEffectiveCoordinator, coordinatorWingClassIds]);

  // Toggle: split-view in coordinator mode (when there are any wing
  // classes), flat in admin mode.
  const showCoordinatorGroups =
    isEffectiveCoordinator && coordinatorWingClassIds.length > 0;

  // Use the canonical institution-wide active classes count (same query
  // SchoolStudentsPage / SchoolAdminCommandCenter / dashboards use). This
  // keeps the "Total Classes" stat consistent across pages — deriving it
  // from teachers' assignments was both inflated (one row per
  // (teacher, class, subject)) AND undercounted (classes with no teacher
  // assigned would have been invisible).
  const totalClasses = allClasses?.length ?? 0;
  const uniqueSubjects = new Set(
    teachers?.flatMap((t) => t.class_assignments?.map((ca: { universal_subjects?: { name?: string } }) => ca.universal_subjects?.name).filter(Boolean) || [])
  );

  const handleViewProfile = (userId: string) => {
    setSelectedUserId(userId);
    setViewUserOpen(true);
  };

  const handleAssignClasses = (user: { id: string; full_name: string }) => {
    setSelectedUser(user);
    setAssignClassesOpen(true);
  };

  const handleViewExams = (teacherId: string) => {
    navigate(`/exams?createdBy=${teacherId}`);
  };

  const handlePromoteToCoordinator = (user: { id: string; full_name: string }) => {
    setSelectedUser(user);
    setPromoteToCoordinatorOpen(true);
  };

  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return invokeAdminOperation({ action: "delete_user", data: { userId } });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      toast({ title: "Teacher Deleted", description: "The teacher has been permanently removed." });
      setDeleteUser(null);
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't delete this teacher.", context: "deleteTeacher" }),
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
      const failCount = results.filter(r => r.error).length;
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      toast({
        title: `${successCount} teacher(s) deleted`,
        description: failCount > 0 ? `${failCount} deletion(s) failed.` : undefined,
        variant: failCount > 0 ? "destructive" : "default",
      });
      setSelectedTeacherIds(new Set());
      setBulkDeleteOpen(false);
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Bulk delete failed.", context: "bulkDeleteTeachers" }),
  });

  const canBulkTask = canManageTeachers;

  const activityExport = useTeacherActivityExport();
  const [activitySheetOpen, setActivitySheetOpen] = useState(false);
  const [activityDaysBack, setActivityDaysBack] = useState<number>(30);
  // The same range picker serves two entry points: Download Report >
  // Teachers Activity (every teacher of the school) and the bulk bar's
  // Download Activity Log (the selected teachers).
  const [activityScope, setActivityScope] = useState<"all" | "selected">("selected");

  const allTeachersForExport = () =>
    (teachers ?? []).map((t) => ({ id: t.id, full_name: t.full_name, email: t.email }));

  const teachersForActivity = () =>
    activityScope === "all" ? allTeachersForExport() : getSelectedTeachersForBulk();

  const openDownloadActivitySheet = () => {
    const selected = getSelectedTeachersForBulk();
    if (selected.length === 0) {
      toast({
        title: "No teachers selected",
        description: "Select at least one teacher to download their activity log.",
        variant: "destructive",
      });
      return;
    }
    setActivityScope("selected");
    setActivityDaysBack(30);
    setActivitySheetOpen(true);
  };

  const openAllTeachersActivitySheet = () => {
    if (!teachers || teachers.length === 0) {
      toast({ title: "No data", description: "No teachers to export", variant: "destructive" });
      return;
    }
    setActivityScope("all");
    setActivityDaysBack(30);
    setActivitySheetOpen(true);
  };

  const handleConfirmDownloadActivity = () => {
    const chosen = teachersForActivity();
    if (chosen.length === 0) {
      setActivitySheetOpen(false);
      return;
    }
    activityExport.mutate(
      {
        // Same institution the teacher list above was read from.
        institutionId: roleInfo?.institutionId ?? "",
        teachers: chosen,
        daysBack: activityDaysBack,
      },
      {
        onSuccess: (res) => {
          toast({
            title: "Activity log downloaded",
            description:
              `${res.teacherCount} teacher(s), ${res.activeToday} active today, ${res.eventCount} event(s).` +
              (res.skippedCount > 0
                ? ` ${res.skippedCount} selected account(s) are not teachers of this school and were left out.`
                : ""),
          });
          setActivitySheetOpen(false);
        },
        onError: (err: Error) =>
          toastError(err, {
            fallback: "Couldn't generate the activity log.",
            context: "downloadTeacherActivityLog",
          }),
      },
    );
  };

  const handleGenerateReport = () => {
    if (!teachers || teachers.length === 0) {
      toast({ title: "No data", description: "No teachers to export", variant: "destructive" });
      return;
    }

    const rows: Record<string, string>[] = [];

    for (const teacher of teachers) {
      const assignments = (teacher.class_assignments || []) as Array<{
        class_id: string;
        subject_id: string;
        classes?: { name?: string; section?: string };
        universal_subjects?: { name?: string };
      }>;
      const row: Record<string, string> = {
        "S.No": String(rows.length + 1),
        "Teacher Name": teacher.full_name,
        "Email": teacher.email || "",
        // profiles.phone is the only place a teacher's number is kept, and
        // many schools have not filled it in (1 of 52 at one school on
        // 2026-10-05), so an empty one reads "N/A" rather than a blank cell.
        "Phone Number": teacher.phone?.trim() || "N/A",
      };

      if (assignments.length === 0) {
        row["Classes & Subjects"] = "No assignments";
      } else {
        // Group by class, collect subjects per class
        const classMap: Record<string, { className: string; subjects: string[] }> = {};
        for (const ca of assignments) {
          const className = formatClassName(ca.classes?.name || "Unknown", ca.classes?.section);
          if (!classMap[className]) {
            classMap[className] = { className, subjects: [] };
          }
          if (ca.universal_subjects?.name) {
            classMap[className].subjects.push(ca.universal_subjects.name);
          }
        }

        // Format: "Class 2-B (GK, Punjabi, English), Class 5-A (Mathematics)"
        row["Classes & Subjects"] = Object.values(classMap)
          .map((c) => c.subjects.length > 0 ? `${c.className} (${c.subjects.join(", ")})` : c.className)
          .join(", ");
      }

      rows.push(row);
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Teacher Assignments");

    // Auto-size columns
    const colWidths = Object.keys(rows[0] || {}).map((key) => ({
      wch: Math.max(key.length, ...rows.map((r) => String(r[key] || "").length)) + 2,
    }));
    worksheet["!cols"] = colWidths;

    const out = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
    saveBlob(
      new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      `Teacher_Class_Report_${new Date().toISOString().split("T")[0]}.xlsx`,
    );

    toast({ title: "Report downloaded", description: `Exported ${rows.length} teacher records` });
  };

  // Bulk selection helpers
  const toggleTeacherSelection = (teacherId: string) => {
    setSelectedTeacherIds((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) {
        next.delete(teacherId);
      } else {
        next.add(teacherId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedTeacherIds.size === filteredTeachers?.length) {
      setSelectedTeacherIds(new Set());
    } else {
      setSelectedTeacherIds(new Set(filteredTeachers?.map((t) => t.id) || []));
    }
  };

  const clearSelection = () => {
    setSelectedTeacherIds(new Set());
  };

  const getSelectedTeachersForBulk = () => {
    return (
      teachers?.filter((t) => selectedTeacherIds.has(t.id)).map((t) => ({
        id: t.id,
        full_name: t.full_name,
        email: t.email,
      })) || []
    );
  };

  // Deep link from the dashboard's Reports panel: ?report=teacher-details
  // downloads the details sheet, ?report=teacher-activity opens the range
  // picker for every teacher. Runs once, after the teacher list has landed,
  // then drops the parameter so a refresh does not download again.
  const [searchParams, setSearchParams] = useSearchParams();
  const reportParam = searchParams.get("report");
  const reportHandled = useRef(false);
  // The handlers are re-created each render, so the effect reads the latest
  // ones through a ref instead of re-running whenever they change.
  const reportActions = useRef({ openAllTeachersActivitySheet, handleGenerateReport });
  reportActions.current = { openAllTeachersActivitySheet, handleGenerateReport };
  useEffect(() => {
    if (reportHandled.current || !reportParam || !canManageTeachers || !teachers?.length) return;
    reportHandled.current = true;
    if (reportParam === "teacher-activity") reportActions.current.openAllTeachersActivitySheet();
    else if (reportParam === "teacher-details") reportActions.current.handleGenerateReport();
    const next = new URLSearchParams(searchParams);
    next.delete("report");
    setSearchParams(next, { replace: true });
  }, [reportParam, canManageTeachers, teachers, searchParams, setSearchParams]);

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell
      fab={
        canMutateTeacherAccounts ? (
          <AddUserDialog
            defaultInstitutionId={roleInfo?.institutionId}
            defaultRole="teacher"
            allowedRoles={["teacher"]}
            trigger={
              <MobileFab
                label="Add Teacher"
                icon={<Plus className="h-6 w-6" />}
                onClick={() => {
                  // no-op: DialogTrigger asChild injects the real open handler
                }}
              />
            }
          />
        ) : undefined
      }
    >
      {/* Hidden trigger button for AddUserDialog — allows PageHeader.primaryAction to open it */}
      {canMutateTeacherAccounts && (
        <AddUserDialog
          defaultInstitutionId={roleInfo?.institutionId}
          defaultRole="teacher"
          allowedRoles={["teacher"]}
          trigger={
            <button
              ref={addTeacherTriggerRef}
              type="button"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
            />
          }
        />
      )}

      <PageHeader
        icon={<GraduationCap className="h-5 w-5" />}
        title="Teachers"
        subtitle="Manage your school's teaching staff"
        primaryAction={
          canMutateTeacherAccounts
            ? {
                label: "Add Teacher",
                icon: <Plus className="h-4 w-4" />,
                onClick: handleAddTeacher,
              }
            : undefined
        }
        secondaryActions={[
          ...(canBulkTask && roleInfo?.institutionId
            ? [
                {
                  label: "Assign Task to All",
                  icon: <ListChecks className="h-4 w-4" />,
                  onClick: () => {
                    if (selectedTeacherIds.size !== filteredTeachers?.length) {
                      toggleSelectAll();
                    }
                    setBulkTaskOpen(true);
                  },
                },
              ]
            : []),
          ...(canManageTeachers
            ? [
                {
                  // Opens on hover at lg+; inside the phone menu the two
                  // reports are a labelled group. Both cover every teacher of
                  // the school; the bulk bar keeps a selected-teachers copy
                  // of Teachers Activity.
                  label: "Download Report",
                  icon: <FileDown className="h-4 w-4" />,
                  disabled: !teachers || teachers.length === 0,
                  menuItems: [
                    {
                      label: "Teachers Details",
                      icon: <Users className="h-4 w-4" />,
                      onClick: handleGenerateReport,
                    },
                    {
                      label: "Teachers Activity",
                      icon: <Activity className="h-4 w-4" />,
                      onClick: openAllTeachersActivitySheet,
                      disabled: activityExport.isPending,
                    },
                  ],
                },
              ]
            : []),
        ]}
      />

      {/* The dashboard's clay tiles, as on the Admins and Coordinators tabs
          (Naman, 2026-10-07: "do for teachers and students also"). */}
      <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <ClayStatTile label="Total teachers" value={formatNumber(teachers?.length || 0)} icon={<Users />} tone="teal" />
        <ClayStatTile label="Total classes" value={formatNumber(totalClasses)} icon={<Layers />} tone="violet" />
        <ClayStatTile label="Subjects covered" value={formatNumber(uniqueSubjects.size)} icon={<BookOpen />} tone="mint" />
      </div>

      {/* Search + filter row */}
      <div className="mt-6 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search teachers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] shadow-card placeholder:text-ink-500 focus-visible:ring-brand-primary/40"
          />
        </div>
        {/* Filters + Bulk Upload share a single row on desktop so the
            row width isn't wasted. Mobile stacks: filters first
            (horizontal-scroll inside FilterRow), then Bulk Upload
            beneath. `min-w-0` on FilterRow lets it shrink so its
            internal overflow-x-auto can engage on narrow widths. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <FilterRow
            className="flex-1 min-w-0"
            activeCount={
              (classFilter.size > 0 ? 1 : 0) + (wingFilter !== "all" ? 1 : 0)
            }
            onClear={() => {
              setClassFilter(new Set());
              setWingFilter("all");
            }}
          >
          {/* Wings filter — sits BEFORE the classes filter. FilterRow is
              already a single horizontal flex row that scrolls on
              mobile, so both selects share one row on every breakpoint. */}
          {wings && wings.length > 0 && (
            <Select
              value={wingFilter}
              onValueChange={(v) => {
                setWingFilter(v);
                // Reset class filter — a class selected from another
                // wing shouldn't linger once the wing scope changes.
                setClassFilter(new Set());
              }}
            >
              <SelectTrigger className="h-10 rounded-full px-4 text-sm font-medium border bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm w-auto min-w-[140px]">
                <SelectValue placeholder="All Wings" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Wings</SelectItem>
                {wings.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {filteredClasses && filteredClasses.length > 0 && (() => {
            const firstSelected = filteredClasses.find((c) => classFilter.has(c.id));
            const chipLabel =
              classFilter.size === 0
                ? "All Classes"
                : classFilter.size === 1 && firstSelected
                  ? formatClassName(firstSelected.name, firstSelected.section)
                  : firstSelected
                    ? `${formatClassName(firstSelected.name, firstSelected.section)} +${classFilter.size - 1}`
                    : `${classFilter.size} selected`;
            const toggleClass = (id: string) => {
              setClassFilter((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              });
            };
            return (
              <Popover>
                <PopoverTrigger asChild>
                  <FilterChip
                    label={chipLabel}
                    active={classFilter.size > 0}
                    className="min-w-[140px]"
                  />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-0">
                  <div className="flex items-center justify-between px-3 py-2 border-b">
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">
                      Filter by class
                    </span>
                    {classFilter.size > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-ink-600"
                        onClick={() => setClassFilter(new Set())}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                  <div className="max-h-72 overflow-y-auto overscroll-contain">
                    <ul className="list-none p-1">
                      {filteredClasses.map((cls) => {
                        const checked = classFilter.has(cls.id);
                        return (
                          <li key={cls.id}>
                            <button
                              type="button"
                              onClick={() => toggleClass(cls.id)}
                              className="w-full flex items-center justify-between gap-2 rounded-md px-2.5 py-2 text-sm text-left hover:bg-ink-400/5"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <Checkbox
                                  checked={checked}
                                  tabIndex={-1}
                                  className="pointer-events-none"
                                />
                                <span className="truncate">
                                  {formatClassName(cls.name, cls.section)}
                                </span>
                              </span>
                              {checked && (
                                <Check className="h-4 w-4 text-brand-primary shrink-0" />
                              )}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                </PopoverContent>
              </Popover>
            );
          })()}
        </FilterRow>
        {/* Bulk Upload — full-width on mobile so it reads as a primary
            action like the search bar above (no awkward right-aligned
            whitespace), pinned right-edge on desktop. The arbitrary
            descendant selector on the wrapper forces the inner shadcn
            Button (which is `inline-flex`, content-sized by default) to
            take the wrapper's full width on mobile too. */}
        {canMutateTeacherAccounts && (
          <div className="w-full sm:w-auto sm:shrink-0 sm:self-center [&_button]:w-full sm:[&_button]:w-auto">
            <BulkUploadTeachersButton institutionId={roleInfo?.institutionId} />
          </div>
        )}
        </div>
      </div>

      {/* Bulk Selection Bar */}
      {selectedTeacherIds.size > 0 && (
        <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 border-brand-primary/20 bg-brand-primary/5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <Badge variant="secondary" className="text-sm">
                {selectedTeacherIds.size} selected
              </Badge>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {canManageTeachers && (
                <Button onClick={() => setBulkAssignOpen(true)}>
                  <Layers className="h-4 w-4 mr-2" />
                  Bulk Assign Classes &amp; Subjects
                </Button>
              )}
              {canBulkTask && roleInfo?.institutionId && (
                <Button variant="outline" onClick={() => setBulkTaskOpen(true)}>
                  <ClipboardList className="h-4 w-4 mr-2" />
                  Bulk Assign Task
                </Button>
              )}
              {canManageTeachers && (
                <Button
                  variant="outline"
                  onClick={openDownloadActivitySheet}
                  disabled={activityExport.isPending}
                >
                  {activityExport.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Activity className="h-4 w-4 mr-2" />
                  )}
                  {activityExport.isPending ? "Preparing…" : "Download Activity Log"}
                </Button>
              )}
              {canMutateTeacherAccounts && (
                <Button
                  variant="destructive"
                  onClick={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete Selected
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Teachers List */}
      <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-900">Teachers List</h2>
          {canManageTeachers && filteredTeachers && filteredTeachers.length > 0 && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={filteredTeachers.length > 0 && selectedTeacherIds.size === filteredTeachers.length}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all teachers"
              />
              <span className="text-xs text-ink-500">Select all</span>
            </div>
          )}
        </div>

        {filteredTeachers?.length === 0 ? (
          <EmptyState
            icon={<GraduationCap className="h-7 w-7" />}
            title="No teachers yet"
            description="Add teachers to start assigning classes and subjects."
            action={
              canMutateTeacherAccounts
                ? {
                    label: "Add Teacher",
                    icon: <Plus className="h-4 w-4" />,
                    onClick: handleAddTeacher,
                  }
                : undefined
            }
          />
        ) : (() => {
          // Inline render so the same list-row markup works for both
          // the flat (admin) view and the split (coordinator) view
          // without copy-pasting ~100 lines of JSX.
          const renderTeacherRow = (
            teacher: NonNullable<typeof filteredTeachers>[number],
          ) => {
            const assignments = teacher.class_assignments || [];
            const subjects = [
              ...new Set(
                (assignments as Array<{ universal_subjects?: { name?: string } }>)
                  .map((a) => a.universal_subjects?.name)
                  .filter((n): n is string => Boolean(n)),
              ),
            ];
            const isSelected = selectedTeacherIds.has(teacher.id);
            return (
              <ListRow
                key={teacher.id}
                as="li"
                className={isSelected ? "ring-2 ring-brand-primary/40" : undefined}
                leading={
                  <div className="flex items-center gap-2">
                    {canManageTeachers && (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleTeacherSelection(teacher.id)}
                        aria-label={`Select ${teacher.full_name}`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    <UserAvatar
                      name={teacher.full_name}
                      email={teacher.email}
                      avatarPath={teacher.avatar_path}
                      className="h-10 w-10 shrink-0"
                      fallbackClassName="bg-brand-primary/10 text-brand-primary text-sm font-semibold"
                    />
                  </div>
                }
                title={
                  <span className="flex items-center gap-2 flex-wrap">
                    {teacher.full_name}
                    {teacher.isCoordinator && (
                      <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                        <UserCog className="h-3 w-3 mr-1" />
                        Coordinator
                      </Badge>
                    )}
                    <Badge variant={teacher.is_active ? "default" : "secondary"} className="text-xs">
                      {teacher.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </span>
                }
                subtitle={
                  <span>
                    {teacher.email}
                    {subjects.length > 0
                      ? ` · ${subjects.slice(0, 2).join(", ")}${subjects.length > 2 ? ` +${subjects.length - 2}` : ""}`
                      : " · No subjects"}
                  </span>
                }
                trailing={
                  // Radix renders DropdownMenuContent into a Portal, but
                  // React still bubbles synthetic clicks through the
                  // component tree — so without onClick stopPropagation
                  // on the content, every menu-item click also fires the
                  // ListRow's outer onClick (handleViewProfile), which
                  // paints ViewUserSheet on top of whatever the menu
                  // item actually opened.
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
                      <DropdownMenuItem onClick={() => handleViewProfile(teacher.id)}>
                        View Profile
                      </DropdownMenuItem>
                      {canManageTeachers && (
                        <DropdownMenuItem onClick={() => setEditTeacher({ id: teacher.id, full_name: teacher.full_name, email: teacher.email, is_active: teacher.is_active })}>
                          Edit Details
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleAssignClasses({ id: teacher.id, full_name: teacher.full_name })}>
                        Assign Classes &amp; Subjects
                      </DropdownMenuItem>
                      {canSetGoogleEmail && (
                        <DropdownMenuItem onClick={() => setGoogleFor({ id: teacher.id, full_name: teacher.full_name })}>
                          Google account for online PTMs
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => handleViewExams(teacher.id)}>
                        View Exams
                      </DropdownMenuItem>
                      {(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin) && !teacher.isCoordinator && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => handlePromoteToCoordinator({ id: teacher.id, full_name: teacher.full_name })}
                            className="text-purple-600"
                          >
                            <UserCog className="h-4 w-4 mr-2" />
                            Make Coordinator
                          </DropdownMenuItem>
                        </>
                      )}
                      {canMutateTeacherAccounts && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteUser({ id: teacher.id, full_name: teacher.full_name })}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete Teacher
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                }
                onClick={() => handleViewProfile(teacher.id)}
              />
            );
          };

          if (showCoordinatorGroups) {
            return (
              <div className="space-y-5">
                {wingTeachers.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
                      Your Wings&apos; Teachers
                      <span className="ml-1.5 text-ink-400 normal-case font-normal">
                        ({wingTeachers.length})
                      </span>
                    </h3>
                    <ul className="list-none p-0 space-y-2">
                      {wingTeachers.map(renderTeacherRow)}
                    </ul>
                  </div>
                )}
                {otherTeachers.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-500 mb-2">
                      Other Teachers
                      <span className="ml-1.5 text-ink-400 normal-case font-normal">
                        ({otherTeachers.length})
                      </span>
                    </h3>
                    <ul className="list-none p-0 space-y-2">
                      {otherTeachers.map(renderTeacherRow)}
                    </ul>
                  </div>
                )}
              </div>
            );
          }

          return (
            <ul className="list-none p-0 space-y-2">
              {filteredTeachers?.map(renderTeacherRow)}
            </ul>
          );
        })()}
      </div>

      {/* Dialogs and Sheets */}
      <ViewUserSheet
        open={viewUserOpen}
        onOpenChange={setViewUserOpen}
        userId={selectedUserId}
      />

      {roleInfo?.institutionId && (
        <AssignTeacherClassSubjectDialog
          open={assignClassesOpen}
          onOpenChange={setAssignClassesOpen}
          user={selectedUser}
          institutionId={roleInfo.institutionId}
        />
      )}

      {/* Bulk Assign Dialog */}
      {roleInfo?.institutionId && (
        <BulkAssignTeachersDialog
          open={bulkAssignOpen}
          onOpenChange={(open) => {
            setBulkAssignOpen(open);
            if (!open) {
              clearSelection();
            }
          }}
          teachers={getSelectedTeachersForBulk()}
          institutionId={roleInfo.institutionId}
        />
      )}

      {/* Promote to Coordinator Dialog */}
      {institutionId && (
        <PromoteToCoordinatorDialog
          open={promoteToCoordinatorOpen}
          onOpenChange={setPromoteToCoordinatorOpen}
          user={selectedUser}
          institutionId={institutionId}
        />
      )}

      <AlertDialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Teacher?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{deleteUser?.full_name}</strong> from authentication, profiles, roles, class assignments, and all related data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteUser && deleteUserMutation.mutate(deleteUser.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteUserMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Dialog */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={setBulkDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selectedTeacherIds.size} Teacher(s)?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{selectedTeacherIds.size} teacher(s)</strong> from authentication, profiles, roles, class assignments, and all related data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => bulkDeleteMutation.mutate([...selectedTeacherIds])}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleteMutation.isPending ? "Deleting..." : `Delete ${selectedTeacherIds.size} Teacher(s)`}
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
          assignees={getSelectedTeachersForBulk().map(t => ({ id: t.id, full_name: t.full_name }))}
          institutionId={roleInfo.institutionId}
        />
      )}

      <EditTeacherDialog
        open={!!editTeacher}
        onOpenChange={(open) => !open && setEditTeacher(null)}
        teacher={editTeacher}
        // Staff-manager override holders edit basic details only (name +
        // active). Email/password reset routes through the admin-operations
        // edge fn, which has no override — so it stays admin/coordinator-only.
        allowAuthEdit={canMutateTeacherAccounts}
      />

      {googleFor && (
        <GoogleEmailSheet
          open
          onOpenChange={(open) => !open && setGoogleFor(null)}
          userId={googleFor.id}
          displayName={googleFor.full_name}
          self={false}
        />
      )}

      {/* Activity Log timeline picker */}
      <MobileSheet
        open={activitySheetOpen}
        onOpenChange={(open) => {
          // Block closing while the export is running so the user doesn't
          // think the click did nothing — the mutation owns the spinner.
          if (!open && activityExport.isPending) return;
          setActivitySheetOpen(open);
        }}
        title="Download Activity Log"
        subtitle={
          activityScope === "all"
            ? `All ${teachers?.length ?? 0} teacher${teachers?.length === 1 ? "" : "s"} · choose how far back`
            : `${selectedTeacherIds.size} teacher${selectedTeacherIds.size === 1 ? "" : "s"} selected · choose how far back`
        }
        icon={<Activity className="h-4 w-4" />}
        primaryAction={{
          label: "Download",
          onClick: handleConfirmDownloadActivity,
          loading: activityExport.isPending,
        }}
        secondaryAction={{
          label: "Cancel",
          onClick: () => setActivitySheetOpen(false),
          disabled: activityExport.isPending,
        }}
      >
        <ul className="list-none p-0 space-y-2" role="radiogroup" aria-label="Time range">
          {[
            { days: 7, label: "Last 7 days", hint: "Quick weekly engagement check" },
            { days: 30, label: "Last 30 days", hint: "Default: monthly view" },
            { days: 60, label: "Last 60 days", hint: "Two-month view" },
            { days: 90, label: "Last 90 days", hint: "Quarterly view (longest range)" },
          ].map((opt) => {
            const checked = activityDaysBack === opt.days;
            return (
              <li key={opt.days}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => setActivityDaysBack(opt.days)}
                  disabled={activityExport.isPending}
                  className={`w-full flex items-start gap-3 rounded-2xl border px-4 py-3 text-left transition-colors duration-200 disabled:opacity-60 ${
                    checked
                      ? "border-brand-primary bg-brand-primary/5"
                      : "border-surface-stroke bg-white hover:bg-ink-400/5"
                  }`}
                >
                  <span
                    className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                      checked
                        ? "border-brand-primary bg-brand-primary"
                        : "border-ink-400"
                    }`}
                  >
                    {checked && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-ink-900">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-ink-500 mt-0.5">
                      {opt.hint}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-4 text-xs text-ink-500">
          The first tab shows each teacher's status, last active time and last activity. The next tabs count the work each teacher did in the chosen range (exams, homework, attendance, lessons, workday, tasks), followed by the full activity log.
        </p>
      </MobileSheet>
    </PageShell>
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl col-span-2 md:col-span-1" />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </PageShell>
  );
}
