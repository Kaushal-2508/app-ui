import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { cn } from "@/lib/utils";
import { Shield } from "lucide-react";
import type { AdminMetrics } from "@/hooks/useWorkforceData";

export function AdminPerformanceTable({ data }: { data: AdminMetrics[] }) {
  if (data.length === 0) return null;

  return (
    <DashboardSection
      title="Admin Performance"
      description="Operational quality by administrator"
      icon={Shield}
      iconGradient="from-violet-500 to-fuchsia-600"
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/50">
              <TableHead>Admin</TableHead>
              <TableHead className="text-center">Created</TableHead>
              <TableHead className="text-center">Closed</TableHead>
              <TableHead className="text-center">Overdue Under Them</TableHead>
              <TableHead className="text-center">Avg Closure (days)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(a => (
              <TableRow key={a.adminName} className="border-b border-border/30">
                <TableCell className="font-medium text-sm">{a.adminName}</TableCell>
                <TableCell className="text-center text-sm">{a.tasksCreated}</TableCell>
                <TableCell className="text-center text-sm">{a.tasksClosed}</TableCell>
                <TableCell className={cn("text-center text-sm font-medium", a.overdueUnderThem > 0 && "text-red-500")}>
                  {a.overdueUnderThem}
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">{a.avgClosureDays}d</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DashboardSection>
  );
}
