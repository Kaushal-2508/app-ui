import { useState } from "react";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useProfileData } from "@/hooks/useProfileData";
import { ComprehensivePrincipalDashboard } from "@/components/dashboards/ComprehensivePrincipalDashboard";
import { AcademicYearSnapshot } from "@/components/passport/AcademicYearSnapshot";
import { PromoteStudentsDialog } from "@/components/school/PromoteStudentsDialog";
import ScopedSnapshotPage from "./ScopedSnapshotPage";
import { Button } from "@/components/ui/button";
import { Loader2, GraduationCap } from "lucide-react";

export default function SchoolSnapshotPage() {
  const [promoteOpen, setPromoteOpen] = useState(false);
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const { data: profile, isLoading: profileLoading } = useProfileData();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const isAdminRole = roleInfo?.roles?.some(r => ['school_admin', 'super_school_admin', 'super_admin'].includes(r));
  // Coordinators / teachers who are NOT admins get the scoped snapshot (their
  // own wing / taught classes). A user who is both admin and coordinator is
  // still treated as an admin. An admin who also TEACHES follows the view
  // toggle, so the teacher snapshot is reachable while it reads "Teacher".
  const isAdmin = isAdminRole && (!hasDualRole || activeViewRole === "admin");
  const isScopedOnly =
    !isAdmin && (roleInfo?.isCoordinator === true || roleInfo?.isTeacher === true);

  if (roleLoading || profileLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isScopedOnly) {
    return <ScopedSnapshotPage />;
  }

  return (
    <div className="space-y-6">
      <ComprehensivePrincipalDashboard
        institutionId={roleInfo?.institutionId ?? null}
        institutionName={profile?.institution?.name ?? undefined}
      />
      {isAdmin && (
        <div className="px-6 space-y-4">
          <AcademicYearSnapshot institutionId={roleInfo?.institutionId ?? null} />
          <Button onClick={() => setPromoteOpen(true)} className="w-full" variant="outline">
            <GraduationCap className="h-4 w-4 mr-2" />
            Promote Students to Next Class
          </Button>
          {roleInfo?.institutionId && (
            <PromoteStudentsDialog
              open={promoteOpen}
              onOpenChange={setPromoteOpen}
              institutionId={roleInfo.institutionId}
            />
          )}
        </div>
      )}
    </div>
  );
}
