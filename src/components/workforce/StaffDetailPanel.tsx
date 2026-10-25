import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { format } from "date-fns";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { ClipboardList, AlertTriangle, Send, TrendingUp, Clock } from "lucide-react";
import type { WorkforceUser } from "@/hooks/useWorkforceData";
import { getCompletionTrend, getAvgCompletionTime } from "@/hooks/useWorkforceData";

interface StaffDetailPanelProps {
  user: WorkforceUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function StaffDetailPanel({ user, open, onOpenChange }: StaffDetailPanelProps) {
  if (!user) return null;

  const trend = getCompletionTrend(user);
  const avgDays = getAvgCompletionTime(user);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md">
              <ClipboardList className="h-4 w-4" />
            </div>
            <div>
              <SheetTitle className="text-base">{user.name}</SheetTitle>
              <SheetDescription className="text-xs">
                {user.role} · {user.wing}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          <Section title="Open Tasks" count={user.openTasks.length} icon={ClipboardList} gradient="from-blue-400 to-indigo-500">
            {user.openTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              user.openTasks.map(t => (
                <div key={t.id} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-sm truncate flex-1">{t.title}</span>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0">
                    {t.dueDate ? format(new Date(t.dueDate), "MMM d") : "No due date"}
                  </span>
                </div>
              ))
            )}
          </Section>

          <Section title="Overdue Tasks" count={user.overdueTasks.length} icon={AlertTriangle} gradient="from-rose-400 to-red-500">
            {user.overdueTasks.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              user.overdueTasks.map(t => (
                <div key={t.id} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                  <span className="text-sm truncate flex-1">{t.title}</span>
                  <span className="text-xs text-red-500 ml-2 shrink-0">
                    {t.daysOverdue}d overdue
                  </span>
                </div>
              ))
            )}
          </Section>

          <Section title="Tasks Assigned By Them" count={user.assignedByThem.length} icon={Send} gradient="from-amber-400 to-orange-500">
            {user.assignedByThem.length === 0 ? (
              <p className="text-xs text-muted-foreground">None</p>
            ) : (
              user.assignedByThem.map(t => (
                <div key={t.id} className="flex justify-between items-center py-1.5 border-b border-border/30 last:border-0">
                  <div className="truncate flex-1">
                    <span className="text-sm">{t.title}</span>
                    <span className="text-xs text-muted-foreground ml-1">→ {t.assigneeName}</span>
                  </div>
                  <span className="text-xs text-muted-foreground ml-2 shrink-0 capitalize">
                    {t.status.replace(/_/g, " ")}
                  </span>
                </div>
              ))
            )}
          </Section>

          {/* 30-Day Trend */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <div className="p-1 rounded-lg bg-gradient-to-br from-emerald-400 to-green-500 text-white">
                <TrendingUp className="h-3 w-3" />
              </div>
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                30-Day Completion Trend
              </h4>
            </div>
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend}>
                  <XAxis dataKey="week" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={20} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 12 }} />
                  <Line type="monotone" dataKey="count" stroke="hsl(262, 83%, 58%)" strokeWidth={2} dot={{ r: 3, fill: "hsl(262, 83%, 58%)" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Avg Completion Time */}
          <div className="flex items-center justify-between py-3 border-t border-border/30">
            <div className="flex items-center gap-2">
              <div className="p-1 rounded-lg bg-gradient-to-br from-sky-400 to-blue-500 text-white">
                <Clock className="h-3 w-3" />
              </div>
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Avg Completion Time
              </span>
            </div>
            <span className="text-lg font-semibold">
              {avgDays} <span className="text-xs font-normal text-muted-foreground">days</span>
            </span>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, count, icon: Icon, gradient, children }: { title: string; count: number; icon: React.ElementType; gradient: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <div className={`p-1 rounded-lg bg-gradient-to-br ${gradient} text-white`}>
          <Icon className="h-3 w-3" />
        </div>
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title} <span className="text-foreground">({count})</span>
        </h4>
      </div>
      {children}
    </div>
  );
}
