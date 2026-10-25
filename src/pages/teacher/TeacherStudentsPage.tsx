import { useMemo, useRef, useState } from "react";
import {
  Users,
  Search,
  Layers,
  ListChecks,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useQuery } from "@tanstack/react-query";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { ViewUserSheet } from "@/components/admin/ViewUserSheet";
import { BulkAssignTaskDialog } from "@/components/shared/BulkAssignTaskDialog";
import { BulkUpdateStudentsDialog } from "@/components/school/BulkUpdateStudentsDialog";
import { UpdateRollNumberSheet, type RollNumberSheetSection } from "@/components/school/UpdateRollNumberSheet";
import { formatNumber } from "@/lib/formatNumber";
import { formatClassName } from "@/lib/utils";

import { PageShell, PageHeader } from "@/components/shared/page";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow } from "@/components/shared/nav";

type AssignedClass = {
  id: string;
  name: string;
  section: string | null;
  academic_year: string | null;
  is_active: boolean | null;
};

type ClassAssignmentRow = {
  class_id: string;
  classes: AssignedClass | AssignedClass[];
};

type RosterProfile = { id: string; full_name: string; email: string | null };

type RosterRow = {
  user_id: string;
  class_id: string;
  profiles: RosterProfile | RosterProfile[] | null;
};

export default function TeacherStudentsPage() {
  const [search, setSearch] = useState("");
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [viewUserOpen, setViewUserOpen] = useState(false);
  const [bulkTaskOpen, setBulkTaskOpen] = useState(false);
  const [rollSheetOpen, setRollSheetOpen] = useState(false);
  // Set when the roll sheet is opened from a student's profile.
  const [rollSheetSection, setRollSheetSection] = useState<RollNumberSheetSection | null>(null);
  const bulkUpdateTriggerRef = useRef<HTMLButtonElement>(null);

  const { user, loading: loadingAuth } = useAuth();
  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();

  // The counterpart of the teacher-hat guard on SchoolStudentsPage. This page
  // is the subject-scoped roster of what the user teaches, so under the
  // coordinator or admin hat it would show a dual-role user a sliver of the
  // wing or school while the sidebar promises the whole of it. Hand over to
  // the page for that hat and fetch nothing here meanwhile.
  const otherHatPath = !hasDualRole
    ? null
    : activeViewRole === "coordinator"
      ? "/coordinator/students"
      : activeViewRole === "admin"
        ? "/school/students"
        : null;

  // Fetch teacher's assigned classes
  const {
    data: assignedClasses,
    isLoading: loadingClasses,
    isError: classesError,
  } = useQuery({
    queryKey: ["teacher-assigned-classes", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];

      const { data, error } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          classes!inner(id, name, section, academic_year, is_active)
        `)
        .eq("user_id", user.id)
        .eq("role", "teacher")
        // AY rollover leaves last year's class rows inactive; without this
        // filter a stale assignment shows the class twice in the picker.
        .eq("classes.is_active", true);

      if (error) throw error;

      // Deduplicate classes
      const classMap = new Map<string, AssignedClass>();
      (data as ClassAssignmentRow[] | null)?.forEach((ca) => {
        const cls = Array.isArray(ca.classes) ? ca.classes[0] : ca.classes;
        if (cls && !classMap.has(cls.id)) {
          classMap.set(cls.id, cls);
        }
      });

      return Array.from(classMap.values());
    },
    enabled: !!user?.id && !otherHatPath,
  });

  // Every class the teacher is assigned to. React Query value-hashes the key,
  // so a fresh array with the same ids does not trigger an extra fetch.
  const assignedClassIds = (assignedClasses ?? []).map((c) => c.id);

  // Fetch students for ALL assigned classes once, then filter in memory.
  // Fetching per-selected-class made the "Total Students" tile mean different
  // things depending on the filter (a teacher filtered to an empty section saw
  // a bare "0" and concluded the portal was broken) and refetched on every
  // filter change. One fetch also yields per-class counts for the picker.
  const {
    data: students,
    isLoading: loadingStudents,
    isError: studentsError,
  } = useQuery({
    queryKey: ["teacher-class-students", assignedClassIds],
    queryFn: async () => {
      const classIds = assignedClassIds;
      if (classIds.length === 0) return [];

      // Embed the profile in the same request: a follow-up
      // .in("id", [...hundreds of uuids]) builds a multi-KB URL that large
      // rosters can push past the server's request-line limit.
      const { data: rosterRows, error: rosterError } = await supabase
        .from("class_assignments")
        .select(
          "user_id, class_id, profiles!class_assignments_user_id_fkey(id, full_name, email)",
        )
        .in("class_id", classIds)
        .eq("role", "student")
        .range(0, 999);

      if (rosterError) throw rosterError;

      // Optional-subject filtering: a teacher who teaches only an OPTIONAL
      // subject in a class sees just the students enrolled in it, but only
      // once that section has actually recorded choices (the RPC treats an
      // unused optional subject as compulsory). Whole class otherwise.
      const { data: allowed, error: allowedErr } = await supabase.rpc(
        "teacher_roster_student_ids",
        { _teacher: user!.id, _class_ids: classIds },
      );
      if (allowedErr) throw allowedErr;
      const allowedSet = new Set((allowed ?? []).map((r) => r.student_id));

      const classById = new Map((assignedClasses ?? []).map((c) => [c.id, c]));
      const byStudent = new Map<
        string,
        { id: string; full_name: string; email: string; classIds: string[] }
      >();

      for (const row of (rosterRows ?? []) as RosterRow[]) {
        if (!allowedSet.has(row.user_id)) continue;
        const prof = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
        if (!prof) continue;
        const existing = byStudent.get(prof.id);
        if (existing) {
          if (!existing.classIds.includes(row.class_id)) {
            existing.classIds.push(row.class_id);
          }
          continue;
        }
        byStudent.set(prof.id, {
          id: prof.id,
          full_name: prof.full_name,
          email: prof.email ?? "",
          classIds: [row.class_id],
        });
      }

      return Array.from(byStudent.values())
        .map((stu) => {
          const cls = classById.get(stu.classIds[0]);
          return {
            ...stu,
            className: cls ? formatClassName(cls.name, cls.section) : "",
          };
        })
        .sort((a, b) =>
          a.full_name.localeCompare(b.full_name, undefined, {
            numeric: true,
            sensitivity: "base",
          }),
        );
    },
    enabled: !!user?.id && !otherHatPath && (assignedClasses?.length ?? 0) > 0,
  });

  // Students in the picked section (or all of them when no filter is set).
  const studentsInScope = useMemo(() => {
    const all = students ?? [];
    return selectedClassId
      ? all.filter((s) => s.classIds.includes(selectedClassId))
      : all;
  }, [students, selectedClassId]);

  const filteredStudents = studentsInScope.filter(
    (student) =>
      student.full_name.toLowerCase().includes(search.toLowerCase()) ||
      student.email.toLowerCase().includes(search.toLowerCase()),
  );

  // Per-class headcount, so the picker shows which sections are empty BEFORE
  // one is chosen. Alliance has active sections with teachers assigned but no
  // students enrolled; without this, picking one is indistinguishable from a
  // fault.
  const countByClass = useMemo(() => {
    const m = new Map<string, number>();
    for (const stu of students ?? []) {
      for (const cid of stu.classIds) m.set(cid, (m.get(cid) ?? 0) + 1);
    }
    return m;
  }, [students]);

  const selectedClass = selectedClassId
    ? (assignedClasses ?? []).find((c) => c.id === selectedClassId)
    : undefined;
  const selectedClassLabel = selectedClass
    ? formatClassName(selectedClass.name, selectedClass.section)
    : "";

  const handleViewProfile = (userId: string) => {
    setSelectedUserId(userId);
    setViewUserOpen(true);
  };

  const handleAssignTaskAll = () => {
    setBulkTaskOpen(true);
  };

  const handleBulkUpdate = () => bulkUpdateTriggerRef.current?.click();

  const totalStudents = students?.length ?? 0;
  const scopedStudents = studentsInScope.length;
  const rosterFailed = classesError || studentsError;
  const classesCount = assignedClasses?.length ?? 0;

  const isLoading = loadingAuth || loadingClasses;

  if (otherHatPath) {
    return <Navigate to={otherHatPath} replace />;
  }

  if (isLoading) {
    return (
      <PageShell>
        <PageSkeleton />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title="Students"
        subtitle="Manage students in your assigned classes"
        secondaryActions={[
          {
            label: "Assign Task to All",
            icon: <ListChecks className="h-4 w-4" />,
            onClick: handleAssignTaskAll,
          },
          {
            label: "Update Details",
            icon: <RefreshCw className="h-4 w-4" />,
            onClick: handleBulkUpdate,
          },
        ]}
      />

      {/* On a failed query these MUST NOT print "0" - a bold zero above a
          correctly-rendered error still reads as "you have no students".
          "N/A" is the honest value for a number we could not load. */}
      <StatTileGrid mdCols={2}>
        <StatTile
          label={selectedClass ? `In ${selectedClassLabel}` : "Total Students"}
          value={
            rosterFailed
              ? "N/A"
              : formatNumber(selectedClass ? scopedStudents : totalStudents)
          }
          icon={<Users className="h-5 w-5" />}
          tone="teal"
        />
        <StatTile
          label="Classes"
          value={classesError ? "N/A" : formatNumber(classesCount)}
          icon={<Layers className="h-5 w-5" />}
          tone="violet"
        />
      </StatTileGrid>

      <div className="mt-6 space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search students..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-11 rounded-xl"
          />
        </div>
        <FilterRow
          activeCount={selectedClassId ? 1 : 0}
          onClear={() => setSelectedClassId(null)}
        >
          {assignedClasses && assignedClasses.length > 0 && (
            <Select
              value={selectedClassId ?? "all"}
              onValueChange={(v) => setSelectedClassId(v === "all" ? null : v)}
            >
              <SelectTrigger className="h-10 rounded-full px-4 text-sm font-medium border bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm w-auto min-w-[160px]">
                <SelectValue placeholder="All Classes" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Classes</SelectItem>
                {assignedClasses.map((cls) => {
                  const n = countByClass.get(cls.id) ?? 0;
                  return (
                    <SelectItem key={cls.id} value={cls.id}>
                      {formatClassName(cls.name, cls.section)}
                      {students ? ` (${n})` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          )}
        </FilterRow>
      </div>

      <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
        <h2 className="text-base font-semibold text-ink-900">Students List</h2>
        {loadingStudents ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 rounded-2xl" />
            ))}
          </div>
        ) : classesError || studentsError ? (
          // §6: the error state must render BEFORE the empty state — a failed
          // roster query must never read as "no students in your classes".
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            title="Couldn't load students"
            description="Something went wrong loading your student list. Check your connection and reload the page. If it keeps happening, contact your admin."
            reason="error"
          />
        ) : classesCount === 0 ? (
          <EmptyState
            icon={<Layers className="h-7 w-7" />}
            title="No classes assigned"
            description="You don't have any classes assigned yet. Ask your coordinator or admin."
          />
        ) : (filteredStudents?.length ?? 0) === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title={
              search
                ? "No students match your search"
                : selectedClass
                  ? `${selectedClassLabel} has no students yet`
                  : "No students yet"
            }
            description={
              search
                ? "Try a different name or email."
                : selectedClass
                  ? totalStudents > 0
                    ? `Nobody has been enrolled in this section yet. Your other classes have ${formatNumber(totalStudents)} students in total.`
                    : "Nobody has been enrolled in this section yet. Ask your admin to add students to it."
                  : "Your classes don't have any students enrolled yet. Ask your coordinator or admin."
            }
            reason="noData"
            action={
              !search && selectedClassId && totalStudents > 0
                ? {
                    label: "Show all classes",
                    onClick: () => setSelectedClassId(null),
                  }
                : undefined
            }
          />
        ) : (
          <ul className="list-none p-0 space-y-2">
            {filteredStudents?.map((s) => (
              <ListRow
                key={s.id}
                as="li"
                leading={
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary text-sm font-semibold">
                    {s.full_name.substring(0, 2).toUpperCase()}
                  </span>
                }
                title={s.full_name}
                subtitle={`${s.className ? `${s.className} · ` : ""}${s.email}`}
                onClick={() => handleViewProfile(s.id)}
              />
            ))}
          </ul>
        )}
      </div>

      <ViewUserSheet
        userId={selectedUserId}
        open={viewUserOpen}
        onOpenChange={setViewUserOpen}
        onUpdateRollNumbers={(section) => {
          setRollSheetSection(section);
          setRollSheetOpen(true);
        }}
      />

      {roleInfo?.institutionId && (
        <BulkAssignTaskDialog
          open={bulkTaskOpen}
          onOpenChange={setBulkTaskOpen}
          assignees={
            filteredStudents?.map((s) => ({
              id: s.id,
              full_name: s.full_name,
            })) ?? []
          }
          institutionId={roleInfo.institutionId}
        />
      )}

      {/* Update Details (bulk CSV) — opens via the hidden trigger ref */}
      <BulkUpdateStudentsDialog
        institutionId={roleInfo?.institutionId || ""}
        onOpenRollNumberPicker={() => setRollSheetOpen(true)}
        trigger={
          <button ref={bulkUpdateTriggerRef} type="button" tabIndex={-1} aria-hidden />
        }
      />

      {/* Update Roll Number picker — scoped to the teacher's assigned classes */}
      <UpdateRollNumberSheet
        open={rollSheetOpen}
        onOpenChange={(next) => {
          setRollSheetOpen(next);
          if (!next) setRollSheetSection(null);
        }}
        institutionId={roleInfo?.institutionId ?? null}
        allowedClassIds={assignedClassIds}
        initialSection={rollSheetSection}
        // Subject-scoped roster (policy 2026-08-26): a teacher edits roll
        // numbers only for students of their own subjects.
        allowedStudentIds={students?.map((s) => s.id) ?? []}
      />
    </PageShell>
  );
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64 mt-2" />
      </div>
      <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-2">
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
