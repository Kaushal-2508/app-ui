import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { cn } from "@/lib/utils";
import { Layers } from "lucide-react";
import type { WingMetrics } from "@/hooks/useWorkforceData";

export function WingComparisonTable({ data }: { data: WingMetrics[] }) {
  if (data.length === 0) return null;

  return (
    <DashboardSection
      title="Wing Comparison"
      description="Performance breakdown by wing"
      icon={Layers}
      iconGradient="from-teal-400 to-cyan-500"
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/50">
              <TableHead>Wing</TableHead>
              <TableHead className="text-center">Total Tasks</TableHead>
              <TableHead className="text-center">Open</TableHead>
              <TableHead className="text-center">Overdue</TableHead>
              <TableHead className="text-center">Completion %</TableHead>
              <TableHead className="text-center">Avg Days</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(w => (
              <TableRow key={w.wingName} className="border-b border-border/30">
                <TableCell className="font-medium text-sm">{w.wingName}</TableCell>
                <TableCell className="text-center text-sm">{w.totalTasks}</TableCell>
                <TableCell className="text-center text-sm">{w.open}</TableCell>
                <TableCell className={cn("text-center text-sm font-medium", w.overdue > 0 && "text-red-500")}>
                  {w.overdue}
                </TableCell>
                <TableCell className={cn(
                  "text-center text-sm font-medium",
                  w.completionPercent > 80 && "text-emerald-600",
                  w.completionPercent < 50 && "text-red-400",
                )}>
                  {w.completionPercent}%
                </TableCell>
                <TableCell className="text-center text-sm text-muted-foreground">{w.avgCompletionDays}d</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </DashboardSection>
  );
}
