import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";

import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { isPastCutoff, type StaffAttendanceStatus } from "@/hooks/useStaffAttendance";
import { useEffectiveAttendanceSettings, type AttendanceStatus } from "@/hooks/useAttendance";

const todayStr = () => format(new Date(), "yyyy-MM-dd");

export interface StaffListRow {
  id: string;
  fullName: string;
  email: string;
  status: StaffAttendanceStatus | null;
  /**
   * True when `status` was derived client-side (no DB row exists yet but
   * local cutoff has passed). The list UI renders an "Absent · syncing"
   * pill in this case; mutations never read this — they always upsert
   * against the DB row identity.
   */
  derived: boolean;
  /** True iff the DB row had `auto_marked_absent = true` (server-set). */
  autoMarkedAbsent: boolean;
  /** True when an admin upsert replaced an earlier auto-marked row. */
  overridden: boolean;
  checkInAt: string | null;
  checkOutAt: string | null;
  classCount: number;
}

export interface StudentListRow {
  id: string;
  fullName: string;
  email: string;
  rollNumber: string | null;
  admissionNumber: string | null;
  className: string;
  classId: string;
  status: AttendanceStatus | null;
}

interface ProfilePartial {
  id: string;
  full_name: string;
  email: string;
}

/**
 * Teachers (or coordinators, depending on `role`) within the current
 * institution, scoped to the coordinator's wing when the caller is a
 * coordinator. Returns each user's today staff_attendance row + a count
 * of classes they teach so the list can show e.g. "Math · 4 classes".
 */
export function useScopedStaffAttendance(role: "teacher" | "coordinator") {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const isAdmin = roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin;
  const isCoord = roleInfo?.isCoordinator;
  const { classIds: wingClassIds, isLoading: coordLoading } = useCoordinatorClasses();
  const settingsForCutoff = useEffectiveAttendanceSettings(institutionId);

  // Derived "syncing" preview depends on local cutoff. Bucket the cache
  // key by HH:mm so it re-derives once per minute (good enough for a
  // minute-granular cutoff) without churning every second.
  const cutoffBucket = `${settingsForCutoff?.staff_check_in_time ?? ""}|${
    settingsForCutoff?.staff_late_grace_minutes ?? ""
  }|${new Date().toISOString().slice(0, 16)}`;

  return useQuery({
    queryKey: [
      "attendance-list",
      "staff",
      role,
      institutionId,
      isCoord,
      wingClassIds.sort().join(","),
      cutoffBucket,
    ],
    enabled: !!institutionId && (!isCoord || !coordLoading),
    queryFn: async (): Promise<StaffListRow[]> => {
      if (!institutionId) return [];

      // Roster — filter user_roles by institution_id first (so we only
      // process staff from this school), then join profiles. Formerly the
      // query had no institution_id filter and relied on
      // `profiles.institution_id === institutionId` to narrow the set —
      // that silently dropped any staff whose profile.institution_id is
      // null or points at a different institution (same class of bug as the
      // workforce "Unknown" fix on 2026-05-14).
      const { data: roleRows, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id, role, profiles!user_roles_user_id_fkey(id, full_name, email)")
        .eq("role", role)
        .eq("institution_id", institutionId);
      if (rolesErr) throw rolesErr;

      type RoleJoin = {
        user_id: string;
        role: string;
        profiles: ProfilePartial | null;
      };
      const roster = new Map<string, ProfilePartial>();
      ((roleRows ?? []) as RoleJoin[]).forEach((r) => {
        if (!r.profiles) return;
        if (!roster.has(r.user_id)) {
          roster.set(r.user_id, {
            id: r.profiles.id,
            full_name: r.profiles.full_name,
            email: r.profiles.email,
          });
        }
      });

      if (roster.size === 0) return [];

      // For coordinator scope, narrow staff to those assigned to a class
      // in the coordinator's wings.
      let staffIds = [...roster.keys()];
      if (!isAdmin && isCoord) {
        if (wingClassIds.length === 0) return [];
        const { data: assigns, error: aErr } = await supabase
          .from("class_assignments")
          .select("user_id")
          .eq("role", role)
          .in("class_id", wingClassIds);
        if (aErr) throw aErr;
        const wingStaff = new Set(((assigns ?? []) as { user_id: string }[]).map((a) => a.user_id));
        staffIds = staffIds.filter((id) => wingStaff.has(id));
      }
      if (staffIds.length === 0) return [];

      // Class counts per staff (institution-wide; for coord we already
      // filtered the staff set, so the count still reflects total load).
      const { data: ca, error: caErr } = await supabase
        .from("class_assignments")
        .select("user_id, class_id")
        .eq("role", role)
        .in("user_id", staffIds);
      if (caErr) throw caErr;
      const classCount = new Map<string, number>();
      ((ca ?? []) as { user_id: string; class_id: string }[]).forEach((row) => {
        const seen = classCount.get(row.user_id) ?? 0;
        classCount.set(row.user_id, seen + 1);
      });

      // Today's staff_attendance_records for these IDs.
      const { data: sar, error: sarErr } = await supabase
        .from("staff_attendance_records" as never)
        .select("staff_id, status, check_in_at, check_out_at, auto_marked_absent, created_at, updated_at")
        .in("staff_id", staffIds)
        .eq("date", todayStr());
      if (sarErr) throw sarErr;
      type SarRow = {
        staff_id: string;
        status: StaffAttendanceStatus;
        check_in_at: string | null;
        check_out_at: string | null;
        auto_marked_absent: boolean;
        created_at: string;
        updated_at: string;
      };
      const sarMap = new Map<string, SarRow>();
      ((sar ?? []) as SarRow[]).forEach((s) => sarMap.set(s.staff_id, s));

      // Derived "Absent · syncing" preview — teacher has no row yet and
      // local cutoff has passed. The DB cron / page-view RPC materializes
      // a real row within ~1–2s; the preview keeps the list honest in the
      // interim. Coordinators do not auto-mark, so derivation is teacher-only.
      const pastCutoff = role === "teacher" && isPastCutoff(settingsForCutoff);

      const rows: StaffListRow[] = staffIds.map((id) => {
        const p = roster.get(id)!;
        const today = sarMap.get(id);
        const hasRow = !!today;
        const derived = !hasRow && pastCutoff;
        const overridden =
          hasRow && !today.auto_marked_absent &&
          new Date(today.updated_at).getTime() - new Date(today.created_at).getTime() > 1000;
        return {
          id,
          fullName: p.full_name,
          email: p.email,
          status: today?.status ?? (derived ? "absent" : null),
          derived,
          autoMarkedAbsent: today?.auto_marked_absent ?? false,
          overridden,
          checkInAt: today?.check_in_at ?? null,
          checkOutAt: today?.check_out_at ?? null,
          classCount: classCount.get(id) ?? 0,
        };
      });
      rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
      return rows;
    },
  });
}

/**
 * Students within the current institution, optionally filtered by class.
 * Coordinator-scoped to the wing's class_ids when the caller is a coordinator.
 */
export function useScopedStudentsAttendance(classId: string | null) {
  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const isAdmin = roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin;
  const isCoord = roleInfo?.isCoordinator;
  const isTeacher = roleInfo?.isTeacher;
  const { classIds: wingClassIds, isLoading: coordLoading } = useCoordinatorClasses();

  // Teachers can browse a roster only for an explicit class they're
  // assigned to (RLS does the actual gating). A teacher trying to load
  // the institution-wide list (no classId) should see nothing.
  const allowGeneralList = isAdmin || isCoord;

  return useQuery({
    queryKey: ["attendance-list", "students", institutionId, classId, isCoord, isTeacher, wingClassIds.sort().join(",")],
    enabled: !!institutionId && (!isCoord || !coordLoading),
    queryFn: async (): Promise<StudentListRow[]> => {
      if (!institutionId) return [];
      if (!classId && !allowGeneralList) return [];

      let q = supabase
        .from("class_assignments")
        .select(
          "user_id, class_id, " +
            "profiles!class_assignments_user_id_fkey(id, full_name, email, roll_number, admission_number), " +
            "classes!class_assignments_class_id_fkey(id, name, section, institution_id)",
        )
        .eq("role", "student");

      if (classId) {
        // RLS handles authorization (teachers only for their assigned
        // classes, etc.). No client-side wing filter when class is explicit.
        q = q.eq("class_id", classId);
      } else if (!isAdmin && isCoord) {
        if (wingClassIds.length === 0) return [];
        q = q.in("class_id", wingClassIds);
      }

      const { data, error } = await q;
      if (error) throw error;

      type Row = {
        user_id: string;
        class_id: string;
        // institution_id intentionally not selected from profiles — the
        // classes join + RLS already scope to this institution, and
        // filtering by profiles.institution_id silently drops students
        // whose profile is institution-less or cross-institution.
        profiles:
          | (ProfilePartial & { roll_number: string | null; admission_number: string | null })
          | null;
        classes: { id: string; name: string; section: string | null; institution_id: string } | null;
      };
      const seen = new Map<string, StudentListRow>();
      ((data ?? []) as unknown as Row[]).forEach((r) => {
        if (!r.profiles) return;
        if (!r.classes || r.classes.institution_id !== institutionId) return;
        if (seen.has(r.user_id)) return;
        const className = r.classes.section ? `${r.classes.name} ${r.classes.section}` : r.classes.name;
        seen.set(r.user_id, {
          id: r.user_id,
          fullName: r.profiles.full_name,
          email: r.profiles.email,
          rollNumber: r.profiles.roll_number,
          admissionNumber: r.profiles.admission_number,
          className,
          classId: r.class_id,
          status: null,
        });
      });

      const studentIds = [...seen.keys()];
      if (studentIds.length === 0) return [];

      // Attach today's attendance status. Pick the first record per student
      // (a student typically has one row per day per class).
      const { data: ar, error: arErr } = await supabase
        .from("attendance_records")
        .select("student_id, status")
        .in("student_id", studentIds)
        .eq("date", todayStr());
      if (arErr) throw arErr;
      type ArRow = { student_id: string; status: AttendanceStatus };
      ((ar ?? []) as ArRow[]).forEach((a) => {
        const row = seen.get(a.student_id);
        if (row) row.status = a.status;
      });

      const rows = [...seen.values()];
      rows.sort((a, b) => {
        // Group by class first, then roll-number-aware sort within class.
        if (a.className !== b.className) return a.className.localeCompare(b.className);
        const ar2 = a.rollNumber ?? "";
        const br = b.rollNumber ?? "";
        if (ar2 && !br) return -1;
        if (!ar2 && br) return 1;
        if (ar2 && br) {
          const an = parseInt(ar2, 10);
          const bn = parseInt(br, 10);
          if (!isNaN(an) && !isNaN(bn) && an !== bn) return an - bn;
        }
        return a.fullName.localeCompare(b.fullName);
      });
      return rows;
    },
  });
}

/**
 * Computed counts (present / late / absent / leave / no record) for a list,
 * used by the list panel header chips. Shared by student AND staff
 * lists (AttendanceListPanel, TeacherClassAttendanceFlow) — `late`
 * is dead-but-harmless for student rows post-2026-07, kept for staff.
 *
 * `leave` collects every excused value from BOTH planes (student
 * `leave`/`sick`/`casual`, staff `on_leave`) so the chips still sum to the
 * row total. Anything genuinely unrecognised lands in `other`; both
 * consumers render it, so a new status can no longer vanish silently.
 */
export function useAttendanceCounts<T extends { status: string | null }>(rows: T[] | undefined) {
  return useMemo(() => {
    const counts = { present: 0, late: 0, absent: 0, leave: 0, none: 0, other: 0 };
    (rows ?? []).forEach((r) => {
      switch (r.status) {
        case "present": counts.present++; break;
        // student rows are never 'late' post-2026-07; kept for the staff plane
        case "late":    counts.late++; break;
        case "absent":  counts.absent++; break;
        case "leave":
        case "sick":
        case "casual":
        case "on_leave":
                        counts.leave++; break;
        case null:
        case undefined:
                        counts.none++; break;
        default:        counts.other++; break;
      }
    });
    return counts;
  }, [rows]);
}
