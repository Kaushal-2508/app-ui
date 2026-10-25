import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHeader } from "@/components/ui/sortable-table-header";
import { DashboardSection } from "@/components/ui/dashboard-section";
import { useTableSort } from "@/hooks/useTableSort";
import { format, differenceInDays } from "date-fns";
import { cn } from "@/lib/utils";
import { ClipboardList } from "lucide-react";
import type { WorkforceUser } from "@/hooks/useWorkforceData";

interface WorkforceTableProps {
  users: WorkforceUser[];
  onSelectUser: (user: WorkforceUser) => void;
}

export function WorkforceTable({ users, onSelectUser }: WorkforceTableProps) {
  const { sortedData, sortConfig, handleSort } = useTableSort(users, { key: "overdue", direction: "desc" });

  const now = new Date();

  return (
    <DashboardSection
      title="Staff Performance"
      description="Click a row to view details"
      icon={ClipboardList}
      iconGradient="from-blue-400 to-indigo-500"
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-b border-border/50">
              <SortableTableHeader label="Name" sortKey="name" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} />
              <SortableTableHeader label="Role" sortKey="role" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} />
              <SortableTableHeader label="Wing" sortKey="wing" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} />
              <SortableTableHeader label="Assigned" sortKey="tasksAssignedByThem" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} className="text-center" />
              <SortableTableHeader label="Open" sortKey="open" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} className="text-center" />
              <SortableTableHeader label="In Progress" sortKey="inProgress" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} className="text-center" />
              <SortableTableHeader label="Overdue" sortKey="overdue" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} className="text-center" />
              <SortableTableHeader label="Completed" sortKey="completed" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} className="text-center" />
              <SortableTableHeader label="Completion %" sortKey="completionPercent" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} className="text-center" />
              <SortableTableHeader label="Last Activity" sortKey="lastActivity" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} />
              <SortableTableHeader label="Workload" sortKey="workloadScore" currentSortKey={sortConfig.key} currentDirection={sortConfig.direction} onSort={handleSort} className="text-center" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedData.map(u => {
              const inactiveDays = u.lastActivity ? differenceInDays(now, new Date(u.lastActivity)) : 999;
              return (
                <TableRow
                  key={u.userId}
                  className="cursor-pointer hover:bg-muted/50 border-b border-border/30"
                  onClick={() => onSelectUser(u)}
                >
                  <TableCell className="font-medium text-sm">{u.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.role}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{u.wing}</TableCell>
                  <TableCell className="text-center text-sm">{u.tasksAssignedByThem}</TableCell>
                  <TableCell className="text-center text-sm">{u.open}</TableCell>
                  <TableCell className="text-center text-sm">{u.inProgress}</TableCell>
                  <TableCell className={cn("text-center text-sm font-medium", u.overdue > 0 && "text-red-500")}>
                    {u.overdue}
                  </TableCell>
                  <TableCell className="text-center text-sm">{u.completed}</TableCell>
                  <TableCell className={cn(
                    "text-center text-sm font-medium",
                    u.completionPercent > 80 && "text-emerald-600",
                    u.completionPercent < 50 && u.totalAssigned > 0 && "text-red-400",
                  )}>
                    {u.completionPercent}%
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      {inactiveDays > 7 && (
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" title="Inactive 7+ days" />
                      )}
                      {u.lastActivity ? format(new Date(u.lastActivity), "MMM d") : "N/A"}
                    </span>
                  </TableCell>
                  <TableCell className="text-center text-sm font-medium">{u.workloadScore}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </DashboardSection>
  );
}
