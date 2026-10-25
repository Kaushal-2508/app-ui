import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface WorkforceFiltersProps {
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  wingFilter: string;
  setWingFilter: (v: string) => void;
  overdueFilter: string;
  setOverdueFilter: (v: string) => void;
  completionFilter: string;
  setCompletionFilter: (v: string) => void;
  activityFilter: string;
  setActivityFilter: (v: string) => void;
  availableWings: string[];
}

export function WorkforceFilters({
  roleFilter, setRoleFilter,
  wingFilter, setWingFilter,
  overdueFilter, setOverdueFilter,
  completionFilter, setCompletionFilter,
  activityFilter, setActivityFilter,
  availableWings,
}: WorkforceFiltersProps) {
  return (
    <div className="flex flex-wrap gap-2">
      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Role</span>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Roles</SelectItem>
            <SelectItem value="school_admin">Admin</SelectItem>
            <SelectItem value="coordinator">Coordinator</SelectItem>
            <SelectItem value="teacher">Teacher</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Wing</span>
        <Select value={wingFilter} onValueChange={setWingFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl">
            <SelectValue placeholder="Wing" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Wings</SelectItem>
            {availableWings.map(w => (
              <SelectItem key={w} value={w}>{w}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Overdue Tasks</span>
        <Select value={overdueFilter} onValueChange={setOverdueFilter}>
          <SelectTrigger className="w-[120px] h-8 text-xs rounded-xl">
            <SelectValue placeholder="Overdue" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Overdue</SelectItem>
            <SelectItem value="0">&gt; 0</SelectItem>
            <SelectItem value="3">&gt; 3</SelectItem>
            <SelectItem value="5">&gt; 5</SelectItem>
            <SelectItem value="10">&gt; 10</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Completion %</span>
        <Select value={completionFilter} onValueChange={setCompletionFilter}>
          <SelectTrigger className="w-[130px] h-8 text-xs rounded-xl">
            <SelectValue placeholder="Completion %" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Rates</SelectItem>
            <SelectItem value="low">&lt; 50%</SelectItem>
            <SelectItem value="mid">50–80%</SelectItem>
            <SelectItem value="high">&gt; 80%</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Activity</span>
        <Select value={activityFilter} onValueChange={setActivityFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs rounded-xl">
            <SelectValue placeholder="Activity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Activity</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive 7+ days</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
