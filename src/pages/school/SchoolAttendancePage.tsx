import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ClipboardCheck,
  ClipboardList,
  Settings,
  Smartphone,
  FileSpreadsheet,
  Layers,
} from "lucide-react";

import { MarkClassFlow } from "@/components/attendance/MarkClassFlow";
import { AttendanceSettings } from "@/components/attendance/AttendanceSettings";
import { MobileCheckinStudent } from "@/components/attendance/MobileCheckinStudent";
import { AttendanceReports } from "@/components/attendance/AttendanceReports";
import { ClassAttendanceFlow } from "@/components/attendance/TeacherClassAttendanceFlow";
import { StaffLeavesTab } from "@/components/attendance/StaffLeavesTab";

import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";

import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";

interface TabSpec {
  value: string;
  label: string;
  icon: React.ReactNode;
  render: () => React.ReactNode;
}

/**
 * STUDENT attendance only (2026-09-26). Everything about staff, the user's
 * own check-in and history, staff attendance lists, the staff leave queue
 * and substitutions, lives on /staff/workday ("Workday"). This page
 * used to mix all of it with class attendance.
 *
 * Per-role tabs:
 *   teacher      → Today's Attendance · Student Leaves · Reports
 *   student      → Check In
 *   coordinator  → Class Attendance · Student Leaves · Reports
 *   admin        → Today's Attendance · Student Leaves · Reports · Settings
 *
 * Reports is shared: admins get staff + students institution-wide, teachers
 * and coordinators get students in their own classes only (enforced by the
 * report_student_* RPCs, not by the UI).
 *
 * Click any name in the Today's Attendance roster → user-detail page at
 * /school/attendance/user/:userId?kind=student
 */
export default function SchoolAttendancePage() {
  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();

  // One hat at a time (§25): a teacher+coordinator or admin+teacher account
  // gets the tab set of the view picked in the app bar, never the union.
  // Before 2026-09-26 this read the raw role flags, so a dual-role user saw
  // every tab of both roles and the switch changed nothing here.
  const isAdmin       = (roleInfo?.isSchoolAdmin ?? false) && (!hasDualRole || activeViewRole === "admin");
  const isTeacher     = hasDualRole ? activeViewRole === "teacher" : (roleInfo?.isTeacher ?? false);
  const isCoordinator = hasDualRole ? activeViewRole === "coordinator" : (roleInfo?.isCoordinator ?? false);
  const isStudent     = roleInfo?.isStudent ?? false;

  // The on-open attendance-pass kick (auto-absent staff rows + pending
  // substitutions) moved to Workday with the staff tabs.

  const tabs = useMemo<TabSpec[]>(() => {
    const list: TabSpec[] = [];

    // Teachers and admins still get the today-marking flow; coordinators
    // explicitly do NOT (per product decision — they coordinate, not mark).
    if (isTeacher || isAdmin) {
      list.push({
        value: "today",
        label: "Today's Attendance",
        icon: <ClipboardCheck className="h-3.5 w-3.5" />,
        render: () => <MarkClassFlow />,
      });
    }

    // (The old "Class Attendance" drill-down tab was retired for
    // teachers/admins 2026-08-11 — Today's Attendance now covers past dates
    // via the date picker and per-student navigation from the roster rows.
    // The teacher's own "My Attendance" tab moved to Workday 2026-09-26.)

    if (isStudent) {
      list.push({
        value: "check-in",
        label: "Check In",
        icon: <Smartphone className="h-3.5 w-3.5" />,
        render: () => <MobileCheckinStudent />,
      });
    }

    // Coordinators keep the read-only class drill-down — it's their only
    // class-attendance surface (they don't get the marking tab). Admins and
    // teachers use Today's Attendance instead.
    if (isCoordinator && !isAdmin) {
      list.push({
        value: "class-attendance",
        label: "Class Attendance",
        icon: <Layers className="h-3.5 w-3.5" />,
        render: () => <ClassAttendanceFlow scopeLabel="Your wing" />,
      });
    }

    // Student leave review — teachers, coordinators, and admins over their
    // scoped students (RLS enforces scope server-side). Coordinators' only
    // leave surface here (they never see the marking roster). Staff leave
    // requests are reviewed on Workday.
    if (isTeacher || isCoordinator || isAdmin) {
      list.push({
        value: "leaves",
        // "Student Leaves", not "Leaves", so it cannot be confused with the
        // Staff Leaves queue on Workday.
        label: "Student Leaves",
        icon: <ClipboardList className="h-3.5 w-3.5" />,
        render: () => <StaffLeavesTab />,
      });
    }

    // Reports — admins get staff + students institution-wide; teachers and
    // coordinators get students in their own classes only (the RPCs enforce
    // that scope server-side; see 20260811140000_scoped_attendance_reports).
    if (isTeacher || isCoordinator || isAdmin) {
      list.push({
        value: "reports",
        label: "Reports",
        icon: <FileSpreadsheet className="h-3.5 w-3.5" />,
        render: () => <AttendanceReports />,
      });
    }

    if (isAdmin) {
      list.push({
        value: "settings",
        label: "Settings",
        icon: <Settings className="h-3.5 w-3.5" />,
        render: () => <AttendanceSettings />,
      });
    }

    return list;
  }, [isTeacher, isStudent, isAdmin, isCoordinator]);

  const [searchParams] = useSearchParams();
  const defaultValue = tabs[0]?.value ?? "leaves";
  // ?tab= opens a tab directly (the dashboard's leave card links to ?tab=leaves); a tab this
  // person's view does not have falls back to the default through safeActive below.
  const [activeTab, setActiveTab] = useState<string>(() => searchParams.get("tab") ?? defaultValue);
  const safeActive = tabs.some((t) => t.value === activeTab) ? activeTab : defaultValue;

  const tabOptions: MobileTabOption[] = tabs.map((t) => ({
    value: t.value,
    label: t.label,
    icon: t.icon,
  }));

  // Students only; anything about staff (own or others') is on Workday.
  const subtitle = isStudent
    ? "Track your daily attendance."
    : isCoordinator && !isAdmin
      ? "Your wing's class attendance and student leaves."
      : "Class attendance, student leaves, and reports.";

  return (
    <PageShell>
      <PageHeader
        icon={<ClipboardCheck className="h-5 w-5" />}
        title="Attendance"
        subtitle={subtitle}
      />

      {tabs.length > 1 && (
        <div className="mt-2">
          <MobileTabs value={safeActive} onValueChange={setActiveTab} options={tabOptions} />
        </div>
      )}

      <div className="mt-4">
        {tabs.find((t) => t.value === safeActive)?.render() ?? null}
      </div>
    </PageShell>
  );
}
