import { useState } from "react";
import { Users, UserCog } from "lucide-react";

import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { AttendanceListPanel } from "@/components/attendance/AttendanceListPanel";
import { useUserRole } from "@/hooks/useUserRole";

type StaffKind = "teachers" | "coordinators";

/**
 * "Staff Attendance" tab — merges what used to be two top-level tabs
 * (Teacher Attendance + Coordinator Attendance) into one, with a segmented
 * sub-tab strip. The panels themselves are unchanged `AttendanceListPanel`s.
 *
 * Access is deliberately unchanged from the two-tab layout: the Coordinators
 * list stays admin-only (`useScopedStaffAttendance("coordinator")` returns
 * every coordinator in the institution, unscoped by wing — showing it to
 * coordinators would be an access expansion, not a layout change). With a
 * single sub-tab available the strip is hidden rather than rendered as a
 * lone pill.
 */
export function StaffAttendanceTab() {
  const { data: roleInfo } = useUserRole();
  const canSeeCoordinators = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin);

  const [subTab, setSubTab] = useState<StaffKind>("teachers");
  const active: StaffKind = canSeeCoordinators ? subTab : "teachers";

  const options: MobileTabOption[] = [
    { value: "teachers", label: "Teachers", icon: <Users className="h-3.5 w-3.5" /> },
    { value: "coordinators", label: "Coordinators", icon: <UserCog className="h-3.5 w-3.5" /> },
  ];

  return (
    <div className="space-y-4">
      {canSeeCoordinators && (
        <MobileTabs
          value={active}
          onValueChange={(v) => setSubTab(v as StaffKind)}
          options={options}
          variant="segmented"
        />
      )}
      <AttendanceListPanel kind={active} />
    </div>
  );
}