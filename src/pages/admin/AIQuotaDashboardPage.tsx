import { useState, useMemo } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { 
  useInstitutionUsersWithAI, 
  useInstitutionAIStats,
  useBulkSetLimits,
  UserAIUsage 
} from "@/hooks/useAIQuotaDashboard";
import { EditUserAILimitDialog } from "@/components/admin/EditUserAILimitDialog";
import { Brain, Users, Zap, Settings2, Search, Pencil, ChevronsUpDown, Check, Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { FIELD_FILL } from "@/lib/fieldStyles";
import { formatNumber } from "@/lib/formatNumber";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { DashboardSection } from "@/components/ui/dashboard-section";

export default function AIQuotaDashboardPage() {
  const [selectedInstitution, setSelectedInstitution] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [editingUser, setEditingUser] = useState<UserAIUsage | null>(null);
  const [bulkLimit, setBulkLimit] = useState<number>(50);
  const [institutionSearchOpen, setInstitutionSearchOpen] = useState(false);
  const [institutionSearch, setInstitutionSearch] = useState("");

  const bulkSetLimits = useBulkSetLimits();

  // Fetch institutions
  const { data: institutions = [] } = useQuery({
    queryKey: ["institutions-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("institutions")
        .select("id, name, code")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Filter institutions by search
  const filteredInstitutions = institutions.filter(
    (inst) =>
      inst.name.toLowerCase().includes(institutionSearch.toLowerCase()) ||
      inst.code.toLowerCase().includes(institutionSearch.toLowerCase())
  );

  const { data: users = [], isLoading: usersLoading } = useInstitutionUsersWithAI(selectedInstitution || null);
  const { data: stats } = useInstitutionAIStats(selectedInstitution || null);

  // Filter users
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      return matchesSearch && matchesRole;
    });
  }, [users, searchQuery, roleFilter]);

  const handleBulkSetLimits = () => {
    if (!selectedInstitution || filteredUsers.length === 0) return;
    bulkSetLimits.mutate({
      userIds: filteredUsers.map((u) => u.user_id),
      institutionId: selectedInstitution,
      dailyLimit: bulkLimit,
    });
  };

  const selectedInstitutionName = institutions.find((i) => i.id === selectedInstitution)?.name;

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <div className="p-2 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-md">
                <Brain className="h-5 w-5" />
              </div>
              AI Quota Management
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage AI question generation limits per user
            </p>
          </div>

          {/* Searchable Institution Selector */}
          <Popover open={institutionSearchOpen} onOpenChange={setInstitutionSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={institutionSearchOpen}
                className={cn("w-[320px] justify-between rounded-xl", FIELD_FILL)}
              >
                <div className="flex items-center gap-2 truncate">
                  <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {selectedInstitution
                      ? institutions.find((i) => i.id === selectedInstitution)?.name
                      : "Select institution..."}
                  </span>
                </div>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[320px] p-0">
              <Command>
                <CommandInput 
                  placeholder="Search institutions..." 
                  value={institutionSearch}
                  onValueChange={setInstitutionSearch}
                />
                <CommandList>
                  <CommandEmpty>No institution found.</CommandEmpty>
                  <CommandGroup>
                    {filteredInstitutions.map((inst) => (
                      <CommandItem
                        key={inst.id}
                        value={inst.id}
                        onSelect={(value) => {
                          setSelectedInstitution(value === selectedInstitution ? "" : value);
                          setInstitutionSearchOpen(false);
                          setInstitutionSearch("");
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            selectedInstitution === inst.id ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="flex flex-col">
                          <span>{inst.name}</span>
                          <span className="text-xs text-muted-foreground">{inst.code}</span>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>

        {!selectedInstitution ? (
          <Card className="rounded-2xl">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Brain className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Select an institution to view and manage AI quotas</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
              <GradientKPICard
                icon={Users}
                value={formatNumber(stats?.total_users || 0)}
                label="Total Users"
                subLabel={`${formatNumber(stats?.users_with_limits || 0)} with limits set`}
                variant="blue"
                infoTooltip="Total users in this institution who can use AI features."
              />
              <GradientKPICard
                icon={Zap}
                value={formatNumber(stats?.total_questions_today || 0)}
                label="Questions Today"
                subLabel={`of ${formatNumber(stats?.total_daily_limit || 0)} total limit`}
                variant="amber"
                infoTooltip="AI questions generated today across all users in this institution."
              />
              <GradientKPICard
                icon={Settings2}
                value={stats?.institution_quota?.daily_question_limit || "∞"}
                label="Institution Limit"
                subLabel="daily questions"
                variant="purple"
                infoTooltip="Maximum daily AI question generation limit set for this institution."
              />
              <GradientKPICard
                icon={Brain}
                value={stats?.institution_quota?.question_generation_enabled ? "Enabled" : "Disabled"}
                label="AI Status"
                subLabel={`for ${selectedInstitutionName}`}
                variant={stats?.institution_quota?.question_generation_enabled ? "emerald" : "slate"}
                infoTooltip="Whether AI question generation is enabled for this institution."
              />
            </div>

            {/* User AI Usage Table */}
            <DashboardSection
              title="User AI Usage"
              description="View and manage individual user AI question generation limits"
              icon={Zap}
              iconGradient="from-amber-400 to-orange-500"
            >
              <div className="space-y-4">
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div className="flex gap-2 flex-1">
                    <div className="relative flex-1 max-w-sm">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search by name or email..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 rounded-xl"
                      />
                    </div>
                    <Select value={roleFilter} onValueChange={setRoleFilter}>
                      <SelectTrigger className="w-[150px] rounded-xl">
                        <SelectValue placeholder="Filter by role" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Roles</SelectItem>
                        <SelectItem value="teacher">Teacher</SelectItem>
                        <SelectItem value="coordinator">Coordinator</SelectItem>
                        <SelectItem value="school_admin">School Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      max={1000}
                      value={bulkLimit}
                      onChange={(e) => setBulkLimit(parseInt(e.target.value) || 0)}
                      className="w-24 rounded-xl"
                    />
                    <Button
                      variant="outline"
                      onClick={handleBulkSetLimits}
                      disabled={bulkSetLimits.isPending || filteredUsers.length === 0}
                      className="rounded-xl"
                    >
                      Set All ({filteredUsers.length})
                    </Button>
                  </div>
                </div>

                {/* Users Table */}
                <div className="rounded-xl border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[180px]">User</TableHead>
                        <TableHead className="min-w-[100px]">Role</TableHead>
                        <TableHead className="min-w-[100px]">Used Today</TableHead>
                        <TableHead className="min-w-[100px]">Daily Limit</TableHead>
                        <TableHead className="min-w-[120px]">Usage</TableHead>
                        <TableHead className="text-right min-w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {usersLoading ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8">
                            Loading users...
                          </TableCell>
                        </TableRow>
                      ) : filteredUsers.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                            No users found
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredUsers.map((user) => {
                          const usagePercent = user.daily_limit > 0
                            ? Math.min((user.questions_used_today / user.daily_limit) * 100, 100)
                            : 0;

                          return (
                            <TableRow key={user.id}>
                              <TableCell>
                                <div className="min-w-[150px]">
                                  <div className="font-medium truncate">{user.full_name}</div>
                                  <div className="text-sm text-muted-foreground truncate">{user.email}</div>
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline" className="capitalize whitespace-nowrap">
                                  {user.role.replace("_", " ")}
                                </Badge>
                              </TableCell>
                              <TableCell>
                                <span className="font-mono">{user.questions_used_today}</span>
                              </TableCell>
                              <TableCell>
                                <span className="font-mono">
                                  {user.daily_limit > 0 ? user.daily_limit : "N/A"}
                                </span>
                              </TableCell>
                              <TableCell>
                                {user.daily_limit > 0 ? (
                                  <div className="space-y-1 min-w-[100px]">
                                    <Progress
                                      value={usagePercent}
                                      className={`h-2 ${usagePercent >= 90 ? '[&>div]:bg-destructive' : usagePercent >= 70 ? '[&>div]:bg-yellow-500' : ''}`}
                                    />
                                    <span className="text-xs text-muted-foreground">
                                      {usagePercent.toFixed(0)}%
                                    </span>
                                  </div>
                                ) : (
                                  <span className="text-xs text-muted-foreground">No limit</span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setEditingUser(user)}
                                >
                                  <Pencil className="h-4 w-4 mr-1" />
                                  Edit
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </DashboardSection>
          </>
        )}
      </div>

      <EditUserAILimitDialog
        open={!!editingUser}
        onOpenChange={(open) => !open && setEditingUser(null)}
        user={editingUser}
        institutionId={selectedInstitution}
      />
    </>
  );
}
