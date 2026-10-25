import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { Users, Inbox, AlertTriangle, CheckCircle2, ArrowLeft } from "lucide-react";
import { useWorkforceData, type WorkforceUser } from "@/hooks/useWorkforceData";
import { WorkforceFilters } from "@/components/workforce/WorkforceFilters";
import { WorkforceTable } from "@/components/workforce/WorkforceTable";
import { StaffDetailPanel } from "@/components/workforce/StaffDetailPanel";
import { WingComparisonTable } from "@/components/workforce/WingComparisonTable";
import { AdminPerformanceTable } from "@/components/workforce/AdminPerformanceTable";
import { differenceInDays } from "date-fns";

export default function WorkforceOverviewPage() {
  const { data, isLoading } = useWorkforceData();
  const navigate = useNavigate();
  const [selectedUser, setSelectedUser] = useState<WorkforceUser | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const [roleFilter, setRoleFilter] = useState("all");
  const [wingFilter, setWingFilter] = useState("all");
  const [overdueFilter, setOverdueFilter] = useState("all");
  const [completionFilter, setCompletionFilter] = useState("all");
  const [activityFilter, setActivityFilter] = useState("all");

  const filteredUsers = useMemo(() => {
    if (!data?.users) return [];
    const now = new Date();
    return data.users.filter(u => {
      if (roleFilter !== "all" && u.roleRaw !== roleFilter) return false;
      if (wingFilter !== "all" && u.wing !== wingFilter) return false;
      if (overdueFilter !== "all" && u.overdue <= Number(overdueFilter)) return false;
      if (completionFilter === "low" && u.completionPercent >= 50) return false;
      if (completionFilter === "mid" && (u.completionPercent < 50 || u.completionPercent > 80)) return false;
      if (completionFilter === "high" && u.completionPercent <= 80) return false;
      if (activityFilter === "active" && u.lastActivity && differenceInDays(now, new Date(u.lastActivity)) > 7) return false;
      if (activityFilter === "inactive" && (!u.lastActivity || differenceInDays(now, new Date(u.lastActivity)) <= 7)) return false;
      return true;
    });
  }, [data?.users, roleFilter, wingFilter, overdueFilter, completionFilter, activityFilter]);

  const handleSelectUser = (user: WorkforceUser) => {
    setSelectedUser(user);
    setPanelOpen(true);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    );
  }

  if (!data) return null;

  const { kpis, wingMetrics, adminMetrics, availableWings, isSuperSchoolAdmin } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Workforce Overview</h1>
            <p className="text-muted-foreground text-sm">Management accountability dashboard</p>
          </div>
        </div>
        <Button variant="outline" className="rounded-xl" onClick={() => navigate("/tasks")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Tasks
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GradientKPICard icon={Users} value={kpis.totalUsers} label="Active Users" variant="blue" infoTooltip="Total staff members (admins, coordinators, teachers) with at least one task assigned." />
        <GradientKPICard icon={Inbox} value={kpis.totalOpen} label="Open Tasks" variant="orange" infoTooltip="Sum of all tasks currently in 'Open' or 'In Progress' status across all staff." />
        <GradientKPICard icon={AlertTriangle} value={kpis.totalOverdue} label="Overdue Tasks" variant="red" infoTooltip="Tasks past their due date that have not been completed. Overdue tasks double-weight the Workload Score." />
        <GradientKPICard icon={CheckCircle2} value={`${kpis.completionRate}%`} label="Completion Rate" variant="emerald" infoTooltip="Percentage of total assigned tasks that have been marked as completed: (Completed ÷ Total) × 100." />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {filteredUsers.length} staff members
        </span>
        <WorkforceFilters
          roleFilter={roleFilter}
          setRoleFilter={setRoleFilter}
          wingFilter={wingFilter}
          setWingFilter={setWingFilter}
          overdueFilter={overdueFilter}
          setOverdueFilter={setOverdueFilter}
          completionFilter={completionFilter}
          setCompletionFilter={setCompletionFilter}
          activityFilter={activityFilter}
          setActivityFilter={setActivityFilter}
          availableWings={availableWings}
        />
      </div>

      {/* Performance Table */}
      {filteredUsers.length === 0 ? (
        <div className="py-16 text-center border border-border/40 rounded-2xl">
          <Users className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No staff data available</p>
        </div>
      ) : (
        <WorkforceTable users={filteredUsers} onSelectUser={handleSelectUser} />
      )}

      {/* Drill-down Panel */}
      <StaffDetailPanel
        user={selectedUser}
        open={panelOpen}
        onOpenChange={setPanelOpen}
      />

      {/* SuperAdmin Sections */}
      {isSuperSchoolAdmin && (
        <>
          <WingComparisonTable data={wingMetrics} />
          <AdminPerformanceTable data={adminMetrics} />
        </>
      )}
    </div>
  );
}
