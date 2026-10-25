import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { sortClassRows } from "@/lib/classSort";

export interface TeacherAttendanceClass {
  id: string;
  name: string;
  section: string | null;
}

/**
 * Classes the signed-in user is assigned to as a teacher. Sorted via the
 * canonical class-name comparator (Nursery → Pre-K → Class 1…12).
 *
 * Phase 5 will extend this to surface a separate "today's substitutions"
 * bucket (tt_substitutions where substitute_teacher_id = me + date = today).
 * Until that lands, marking via a substitution still works server-side —
 * the teacher just won't see the class as a tile until they're added as a
 * regular `class_assignments.role='teacher'` row, which is the existing
 * timetable-substitute behavior.
 */
export function useTeacherAttendanceClasses() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["teacher-attendance-classes", user?.id],
    queryFn: async (): Promise<TeacherAttendanceClass[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, classes!class_assignments_class_id_fkey(id, name, section)")
        .eq("user_id", user.id)
        .eq("role", "teacher");
      if (error) throw error;

      type Row = { class_id: string; classes: TeacherAttendanceClass | null };
      const seen = new Map<string, TeacherAttendanceClass>();
      ((data ?? []) as Row[]).forEach((r) => {
        if (r.classes && !seen.has(r.classes.id)) seen.set(r.classes.id, r.classes);
      });
      return sortClassRows(Array.from(seen.values()), (c) => c.name, (c) => c.section);
    },
    enabled: !!user?.id,
  });
}

/** Set of class_ids the current user has pinned for quick attendance access. */
export function usePinnedClassIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["attendance-pins", user?.id],
    queryFn: async (): Promise<Set<string>> => {
      if (!user?.id) return new Set();
      const { data, error } = await supabase
        .from("attendance_pins")
        .select("class_id")
        .eq("user_id", user.id);
      if (error) throw error;
      return new Set(((data ?? []) as { class_id: string }[]).map((r) => r.class_id));
    },
    enabled: !!user?.id,
  });
}

/** Toggle a class pin for the current user. RLS scopes to the row's user_id. */
export function useTogglePinClass() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ classId, pinned }: { classId: string; pinned: boolean }) => {
      if (!user?.id) throw new Error("Not signed in");
      if (pinned) {
        const { error } = await supabase
          .from("attendance_pins")
          .delete()
          .eq("user_id", user.id)
          .eq("class_id", classId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("attendance_pins")
          .insert({ user_id: user.id, class_id: classId });
        if (error) throw error;
      }
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["attendance-pins"] });
      toast.success(vars.pinned ? "Removed from pinned" : "Pinned to top");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update pinned classes.", context: "togglePinClass" }),
  });
}

export interface ClassStudent {
  id: string;
  full_name: string;
  roll_number: string | null;
  admission_number: string | null;
}

/**
 * Roster for a class, sorted by roll number ascending (numeric-aware) then
 * full name. Strings like "01" sort before "10", and missing roll numbers
 * fall to the bottom.
 */
export function useClassStudents(classId: string | null) {
  return useQuery({
    queryKey: ["class-students-attendance", classId],
    queryFn: async (): Promise<ClassStudent[]> => {
      if (!classId) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("user_id, profiles!class_assignments_user_id_fkey(id, full_name, roll_number, admission_number)")
        .eq("class_id", classId)
        .eq("role", "student");
      if (error) throw error;

      type Row = { user_id: string; profiles: ClassStudent | null };
      const students: ClassStudent[] = ((data ?? []) as Row[])
        .map((r) => r.profiles)
        .filter((p): p is ClassStudent => p !== null);

      students.sort((a, b) => {
        const aRoll = a.roll_number?.trim() ?? "";
        const bRoll = b.roll_number?.trim() ?? "";
        if (aRoll && !bRoll) return -1;
        if (!aRoll && bRoll) return 1;
        if (aRoll && bRoll) {
          const an = parseInt(aRoll, 10);
          const bn = parseInt(bRoll, 10);
          if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
          if (aRoll !== bRoll) return aRoll.localeCompare(bRoll);
        }
        return a.full_name.localeCompare(b.full_name);
      });

      return students;
    },
    enabled: !!classId,
    staleTime: 60_000,
  });
}

export interface ClassAttendanceLockState {
  /** True when the current user can edit the viewed date's records for this class. */
  canEdit: boolean;
  /** Reason why edits are locked, if any. */
  lockReason: "past-window" | "different-marker" | null;
}

/**
 * Determine whether the signed-in user can edit a class's attendance for the
 * date being viewed. Date-based (replaced the old hours-since-marking window
 * 2026-08-11 — spec: docs/superpowers/specs/2026-08-11-attendance-date-window-design.md):
 *
 *   - Admins → always editable (matches their full-access RLS).
 *   - Date older than `today − windowDays`, or in the future → locked ("past-window").
 *   - Any record marked by someone else → locked ("different-marker").
 *   - Otherwise editable — including backfilling an unmarked past date
 *     within the window.
 *
 * `windowDays` comes from `attendance_settings.student_attendance_edit_window_days`
 * (default 2 → today + 2 days back). "Today" is browser-local, consistent with
 * the rest of the frontend (fine for India-only; the DB trigger
 * `enforce_student_attendance_edit_window` is the institution-timezone
 * authority).
 */
export function computeAttendanceLock(
  records: { marked_by: string | null }[],
  currentUserId: string | undefined,
  dateStr: string,
  windowDays: number,
  isAdmin: boolean,
): ClassAttendanceLockState {
  if (isAdmin) {
    return { canEdit: true, lockReason: null };
  }

  const today = new Date();
  const toYmd = (d: Date) => {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, "0");
    const day = `${d.getDate()}`.padStart(2, "0");
    return `${y}-${m}-${day}`;
  };
  const min = new Date(today);
  min.setDate(min.getDate() - windowDays);
  if (dateStr < toYmd(min) || dateStr > toYmd(today)) {
    return { canEdit: false, lockReason: "past-window" };
  }

  if (records.length === 0) {
    return { canEdit: true, lockReason: null };
  }
  if (!currentUserId) {
    return { canEdit: false, lockReason: "different-marker" };
  }

  // If any record was marked by someone other than me, that date belongs
  // to that teacher — I shouldn't overwrite their work.
  const otherMarker = records.find((r) => r.marked_by && r.marked_by !== currentUserId);
  if (otherMarker) {
    return { canEdit: false, lockReason: "different-marker" };
  }
  return { canEdit: true, lockReason: null };
}

/**
 * Classes visible to the signed-in user, scoped by role:
 *   - admin   → every active class in the institution
 *   - coord   → wing classes (via wing_class_mappings)
 *   - teacher → assigned classes (class_assignments role='teacher')
 *   - student / unknown → empty
 *
 * Powers the unified Class Attendance flow used in the teacher,
 * coordinator, and admin tabs. The shape matches
 * `TeacherAttendanceClass` so the same render path works for everyone.
 *
 * Returns the same `{ data, isLoading }` shape react-query exposes so
 * call-sites don't change. Internally:
 *   - admin  / teacher branches each have their own useQuery
 *   - coord  branch derives from the upstream useCoordinatorClasses hook
 *     via useMemo (no nested useQuery — that caused a stale-cache bug
 *     where the wrapper ran before useCoordinatorClasses finished).
 */
export function useScopedAttendanceClasses() {
  const { user } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  // One hat at a time (§25). This used to rank admin > coordinator > teacher
  // on the raw role flags, so a teacher+coordinator saw the wing's classes
  // in BOTH views and the app-bar switch changed nothing on attendance,
  // reports or the student-leave filter (2026-09-26).
  const rawAdmin = roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin;
  const isAdmin = rawAdmin && (!hasDualRole || activeViewRole === "admin");
  const isCoord = hasDualRole ? activeViewRole === "coordinator" : roleInfo?.isCoordinator;
  const isTeacher = hasDualRole ? activeViewRole === "teacher" : roleInfo?.isTeacher;

  // Upstream coord source — a real hook that re-renders us when its data lands.
  const { classes: coordClasses, isLoading: coordLoading } = useCoordinatorClasses();

  // Admin branch — institution-wide classes.
  const adminQuery = useQuery({
    queryKey: ["scoped-attendance-classes", "admin", institutionId],
    enabled: !!institutionId && !!isAdmin,
    queryFn: async (): Promise<TeacherAttendanceClass[]> => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId)
        .eq("is_active", true);
      if (error) throw error;
      return sortClassRows(
        (data ?? []) as TeacherAttendanceClass[],
        (c) => c.name,
        (c) => c.section,
      );
    },
  });

  // Teacher branch — assigned classes via class_assignments.
  const teacherQuery = useQuery({
    queryKey: ["scoped-attendance-classes", "teacher", user?.id],
    enabled: !!user?.id && !!isTeacher && !roleLoading,
    queryFn: async (): Promise<TeacherAttendanceClass[]> => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, classes!class_assignments_class_id_fkey(id, name, section)")
        .eq("user_id", user.id)
        .eq("role", "teacher");
      if (error) throw error;
      type Row = { class_id: string; classes: TeacherAttendanceClass | null };
      const seen = new Map<string, TeacherAttendanceClass>();
      ((data ?? []) as Row[]).forEach((r) => {
        if (r.classes && !seen.has(r.classes.id)) seen.set(r.classes.id, r.classes);
      });
      return sortClassRows(Array.from(seen.values()), (c) => c.name, (c) => c.section);
    },
  });

  // Coordinator branch — derive directly from upstream coord classes.
  const coordSorted = useMemo<TeacherAttendanceClass[]>(() => {
    if (!isCoord) return [];
    return sortClassRows(
      coordClasses.map((c) => ({ id: c.id, name: c.name, section: c.section })),
      (c) => c.name,
      (c) => c.section,
    );
  }, [isCoord, coordClasses]);

  const data = useMemo<TeacherAttendanceClass[]>(() => {
    if (isAdmin) return adminQuery.data ?? [];
    if (isCoord) return coordSorted;
    if (isTeacher) return teacherQuery.data ?? [];
    return [];
  }, [isAdmin, isCoord, isTeacher, adminQuery.data, coordSorted, teacherQuery.data]);

  const isLoading =
    roleLoading ||
    (isAdmin && adminQuery.isLoading) ||
    (isCoord && coordLoading) ||
    (isTeacher && teacherQuery.isLoading) ||
    false;

  return { data, isLoading };
}

export interface ClassMarker {
  id: string;
  /** Profile name; null when the caller may not read that profile or it is gone. */
  name: string | null;
}

export interface ClassMarkStatus {
  classId: string;
  /** Attendance records written for the class on that date. */
  total: number;
  markedBySelf: boolean;
  /** Everyone who wrote at least one record that day, self included, busiest first. */
  markers: ClassMarker[];
}

/**
 * Who marked each class on a date, aggregated server-side by the
 * `attendance_class_markers` RPC (one row per class × marker, with the
 * marker's profile name). Replaces the per-student attendance_records fetch
 * that fed the tiles: an admin's institution-wide view crossed PostgREST's
 * silent 1000-row cap (Alliance writes ~1,340 records a day), so classes past
 * the cap read as "Pending", and marked_by is an FK to auth.users so the name
 * could never be embedded client-side.
 *
 * The `attendance-mark-status` key prefix is what attendanceCache.ts
 * invalidates after every attendance write. Keep it.
 */
export function useAttendanceClassMarkers(classIds: string[], dateStr: string) {
  const { user } = useAuth();
  const sortedIds = [...classIds].sort();
  return useQuery({
    queryKey: ["attendance-mark-status", user?.id, dateStr, sortedIds.join(",")],
    queryFn: async (): Promise<Map<string, ClassMarkStatus>> => {
      if (sortedIds.length === 0) return new Map();
      const { data, error } = await supabase.rpc("attendance_class_markers", {
        _class_ids: sortedIds,
        _date: dateStr,
      });
      if (error) throw error;

      const map = new Map<string, ClassMarkStatus>();
      for (const r of data ?? []) {
        const status = map.get(r.class_id) ?? {
          classId: r.class_id,
          total: 0,
          markedBySelf: false,
          markers: [],
        };
        status.total += r.record_count;
        if (r.marked_by) {
          if (r.marked_by === user?.id) status.markedBySelf = true;
          status.markers.push({ id: r.marked_by, name: r.marker_name });
        }
        map.set(r.class_id, status);
      }
      return map;
    },
    enabled: sortedIds.length > 0,
    staleTime: 60_000,
  });
}

/** "A", "A and B", "A, B and C". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Names of everyone other than the current user who marked the class that
 * day, or null when none is known (nobody else, or their profile is not
 * readable by the caller).
 */
export function otherMarkerNames(
  status: ClassMarkStatus | undefined,
  currentUserId: string | undefined,
): string | null {
  if (!status) return null;
  const names = Array.from(
    new Set(
      status.markers
        .filter((m) => m.id !== currentUserId)
        .map((m) => m.name?.trim() ?? "")
        .filter((n) => n.length > 0),
    ),
  );
  return names.length > 0 ? joinNames(names) : null;
}

/**
 * Tile chip copy for a marked class: "Marked by you", "Marked by Priya
 * Sharma", "Marked by you and Priya Sharma". Falls back to "another teacher"
 * for a marker whose name the caller cannot read, and to "Marked today" when
 * the records carry no marker at all.
 */
export function formatMarkerNames(status: ClassMarkStatus, currentUserId: string | undefined): string {
  const parts: string[] = [];
  if (status.markedBySelf) parts.push("you");
  for (const m of status.markers) {
    if (m.id === currentUserId) continue;
    const name = m.name?.trim();
    parts.push(name && name.length > 0 ? name : "another teacher");
  }
  const unique = Array.from(new Set(parts));
  if (unique.length === 0) return "Marked today";
  return `Marked by ${joinNames(unique)}`;
}
