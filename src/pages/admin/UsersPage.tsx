import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Users,
  Search,
  MoreHorizontal,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  Trash2,
  Key,
  Shield,
  GraduationCap,
  UserCheck,
  Crown,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/components/ui/table";
import { SortableTableHeader } from "@/components/ui/sortable-table-header";
import { useTableSort } from "@/hooks/useTableSort";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { AddUserDialog } from "@/components/admin/AddUserDialog";
import { ViewUserSheet } from "@/components/admin/ViewUserSheet";
import { EditUserDialog } from "@/components/admin/EditUserDialog";
import { ChangeRoleDialog } from "@/components/admin/ChangeRoleDialog";
import { EditStudentPasswordDialog } from "@/components/admin/EditStudentPasswordDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { MobileDataCard, MobileDataList } from "@/components/shared/MobileDataCard";
import { GradientKPICard } from "@/components/ui/gradient-kpi-card";
import { DashboardSection } from "@/components/ui/dashboard-section";

const PAGE_SIZES = [10, 25, 50, 100];

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [institutionFilter, setInstitutionFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Dialog states
  const [viewUserId, setViewUserId] = useState<string | null>(null);
  const [editUserId, setEditUserId] = useState<string | null>(null);
  const [changeRoleUser, setChangeRoleUser] = useState<{ id: string; name: string } | null>(null);
  const [assignSuperAdminUser, setAssignSuperAdminUser] = useState<{ id: string; name: string } | null>(null);
  const [deleteUser, setDeleteUser] = useState<{ id: string; name: string; isSuperAdmin: boolean } | null>(null);
  const [passwordResetUser, setPasswordResetUser] = useState<{ id: string; full_name: string; email: string } | null>(
    null,
  );

  // Fetch institutions for filter
  const { data: institutions = [] } = useQuery({
    queryKey: ["institutions-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("institutions")
        .select("id, name")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  // Server-side pagination by full_name string-sort interleaves classes
  // alphabetically (e.g. "Class 1 B" mixes with "Class 10 A" on the same
  // page). Pull the full roster up front and paginate client-side after
  // natural-numeric sort, so "Class 2" precedes "Class 10" globally and
  // pages line up with classes/sections instead of letter ranges.
  // The whole roster in ONE round trip: admin_user_roster (20260928161000)
  // returns every profile with its institution name and roles as a single
  // jsonb value, so PostgREST's 1000-row cap never applies (it clips a
  // set-returning read, not a scalar) and nothing is joined in the browser.
  // It replaced paging profiles and user_roles through fetchAllRows.
  const {
    data: users,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["admin-users-all"],
    staleTime: 60_000,
    queryFn: async () => {
      type RosterEntry = {
        id: string;
        full_name: string | null;
        email: string | null;
        is_active: boolean | null;
        institution_id: string | null;
        created_at: string;
        institution_name: string | null;
        /** Role rows in id order; the first is the page's primary role. */
        roles: string[];
      };
      const { data, error } = await supabase.rpc("admin_user_roster");
      if (error) throw error;
      const roster = (Array.isArray(data) ? data : []) as unknown as RosterEntry[];

      return roster.map(({ institution_name, roles, ...user }) => ({
        ...user,
        institutions: institution_name ? { name: institution_name } : null,
        roles,
        primaryRole: roles[0] ?? "user",
      }));
    },
  });

  // Role counts come from the server (HEAD + exact count per role), never
  // from the length of a downloaded list, which stops at 1000.
  const { data: roleCounts } = useQuery({
    queryKey: ["admin-users-role-counts"],
    staleTime: 60_000,
    queryFn: async () => {
      const ROLES = [
        "super_admin",
        "school_admin",
        "super_school_admin",
        "coordinator",
        "teacher",
        "student",
        "employee",
      ] as const;

      const totals = await Promise.all(
        ROLES.map(async (role) => {
          const { count, error } = await supabase
            .from("user_roles")
            .select("id", { count: "exact", head: true })
            .eq("role", role);
          if (error) throw error;
          return [role, count ?? 0] as const;
        }),
      );

      return Object.fromEntries(totals) as Record<string, number>;
    },
  });

  const deactivateUser = useMutation({
    mutationFn: async (userId: string) => {
      const { error } = await supabase.from("profiles").update({ is_active: false }).eq("id", userId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      toast({ title: "User deactivated" });
    },
    onError: () => {
      toast({ title: "Failed to deactivate user", variant: "destructive" });
    },
  });

  // Delete user permanently
  const deleteUserMutation = useMutation({
    mutationFn: async (userId: string) => {
      return invokeAdminOperation<{ message?: string }>({
        action: "delete_user",
        data: { userId },
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users-count"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users-role-counts"] });
      toast({
        title: "User deleted",
        description: data?.message || "The user and their login credentials have been permanently removed.",
      });
      setDeleteUser(null);
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't delete this user.", context: "deleteUser" }),
  });

  const filteredUsers =
    users?.filter((user) => {
      const matchesSearch =
        user.full_name.toLowerCase().includes(search.toLowerCase()) ||
        user.email.toLowerCase().includes(search.toLowerCase());
      const matchesRole = roleFilter === "all" || user.roles.includes(roleFilter as any);
      const matchesInstitution = institutionFilter === "all" || user.institution_id === institutionFilter;
      return matchesSearch && matchesRole && matchesInstitution;
    }) || [];

  const {
    sortedData: sortedUsers,
    sortConfig,
    handleSort,
  } = useTableSort(filteredUsers, { key: "full_name", direction: "asc" });

  // Client-side pagination after natural sort (replaces the previous
  // server-side range pagination — see fetch comment above).
  const totalCount = filteredUsers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const pageStart = (currentPage - 1) * pageSize;
  const pageUsers = sortedUsers.slice(pageStart, pageStart + pageSize);

  const handlePageChange = (newPage: number) => {
    setCurrentPage(newPage);
  };

  const handlePageSizeChange = (newSize: string) => {
    setPageSize(parseInt(newSize));
    setCurrentPage(1);
  };

  // Assign Super Admin mutation
  const assignSuperAdmin = useMutation({
    mutationFn: async (userId: string) => {
      const { data: existingRoles } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", userId)
        .eq("role", "super_admin");

      if (existingRoles && existingRoles.length > 0) {
        throw new Error("User already has Super Admin role");
      }

      const { error } = await supabase.from("user_roles").insert({ user_id: userId, role: "super_admin" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["admin-users-role-counts"] });
      toast({ title: "Super Admin role assigned successfully" });
      setAssignSuperAdminUser(null);
    },
    onError: (error: any) => {
      toast({
        title: "Failed to assign Super Admin",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (isLoading) {
    return <PageSkeleton />;
  }

  // KPI data
  const totalUsers = totalCount || 0;
  const superAdmins = roleCounts?.super_admin || 0;
  const teacherCount = roleCounts?.teacher || 0;
  const studentCount = roleCounts?.student || 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <div className="p-2 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md">
              <Users className="h-5 w-5" />
            </div>
            Users
          </h1>
          <p className="text-muted-foreground mt-1">Manage all system users and their roles</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="icon" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <AddUserDialog />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        <GradientKPICard
          icon={Users}
          value={totalUsers}
          label="Total Users"
          variant="blue"
          infoTooltip="Total number of user accounts across all institutions."
        />
        <GradientKPICard
          icon={Crown}
          value={superAdmins}
          label="Super Admins"
          variant="purple"
          infoTooltip="Users with full system access and super admin privileges."
        />
        <GradientKPICard
          icon={GraduationCap}
          value={teacherCount}
          label="Teachers"
          variant="amber"
          infoTooltip="Users with teacher role across all institutions."
        />
        <GradientKPICard
          icon={UserCheck}
          value={studentCount}
          label="Students"
          variant="emerald"
          infoTooltip="Users with student role across all institutions."
        />
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search users..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 rounded-xl"
          />
        </div>
        <SearchableSelect
          value={roleFilter}
          onValueChange={setRoleFilter}
          placeholder="Role"
          searchPlaceholder="Search roles..."
          options={[
            { value: "all", label: "All Roles" },
            { value: "super_admin", label: "Super Admin" },
            { value: "school_admin", label: "School Admin" },
            { value: "principal", label: "Principal" },
            { value: "coordinator", label: "Coordinator" },
            { value: "teacher", label: "Teacher" },
            { value: "student", label: "Student" },
            { value: "employee", label: "Employee" },
          ]}
          className="w-[180px]"
        />
        <SearchableSelect
          value={institutionFilter}
          onValueChange={setInstitutionFilter}
          placeholder="Institution"
          searchPlaceholder="Search institutions..."
          options={[
            { value: "all", label: "All Institutions" },
            ...institutions.map((inst) => ({
              value: inst.id,
              label: inst.name,
            })),
          ]}
          className="w-[200px]"
        />
      </div>

      {/* Role Stats - compact badges */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(roleCounts || {}).map(([role, count]) => (
          <Badge key={role} variant="secondary" className="text-sm py-1 px-3 rounded-full capitalize">
            {role.replace(/_/g, " ")}s: <span className="font-bold ml-1">{count}</span>
          </Badge>
        ))}
      </div>

      {/* Users Table */}
      <DashboardSection
        title="All Users"
        description={`${totalUsers} users total`}
        icon={Users}
        iconGradient="from-indigo-500 to-purple-600"
      >
        <ResponsiveUsersList
          users={pageUsers}
          sortConfig={sortConfig}
          handleSort={handleSort}
          onViewUser={(id) => setViewUserId(id)}
          onEditUser={(id) => setEditUserId(id)}
          onChangeRole={(user) => setChangeRoleUser({ id: user.id, name: user.full_name })}
          onResetPassword={(user) => setPasswordResetUser({ id: user.id, full_name: user.full_name, email: user.email })}
          onAssignSuperAdmin={(user) => setAssignSuperAdminUser({ id: user.id, name: user.full_name })}
          onDeactivate={(id) => deactivateUser.mutate(id)}
          onDelete={(user) =>
            setDeleteUser({ id: user.id, name: user.full_name, isSuperAdmin: user.roles.includes("super_admin") })
          }
          currentPage={currentPage}
          pageSize={pageSize}
          totalCount={totalCount}
          totalPages={totalPages}
          onPageChange={handlePageChange}
          onPageSizeChange={handlePageSizeChange}
        />
      </DashboardSection>

      {sortedUsers.length === 0 && (
        <Card className="rounded-2xl">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-medium mb-2">No users found</h3>
            <p className="text-muted-foreground text-center mb-4">Try adjusting your search or filter</p>
          </CardContent>
        </Card>
      )}

      {/* Dialogs */}
      <ViewUserSheet open={!!viewUserId} onOpenChange={(open) => !open && setViewUserId(null)} userId={viewUserId} />
      <EditUserDialog open={!!editUserId} onOpenChange={(open) => !open && setEditUserId(null)} userId={editUserId} />
      <ChangeRoleDialog
        open={!!changeRoleUser}
        onOpenChange={(open) => !open && setChangeRoleUser(null)}
        userId={changeRoleUser?.id || null}
        userName={changeRoleUser?.name || ""}
      />

      {/* Assign Super Admin Confirmation Dialog */}
      <AlertDialog open={!!assignSuperAdminUser} onOpenChange={(open) => !open && setAssignSuperAdminUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-purple-600" />
              Assign Super Admin Role
            </AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to assign Super Admin role to <strong>{assignSuperAdminUser?.name}</strong>? This
              will grant full system access including the ability to manage all institutions, users, and settings.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => assignSuperAdminUser && assignSuperAdmin.mutate(assignSuperAdminUser.id)}
              className="bg-purple-600 hover:bg-purple-700"
            >
              Assign Super Admin
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete User Confirmation Dialog */}
      <AlertDialog open={!!deleteUser} onOpenChange={(open) => !open && setDeleteUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">Permanently Delete User</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Are you sure you want to <strong className="text-foreground">permanently delete</strong>{" "}
                  <strong className="text-foreground">{deleteUser?.name}</strong>?
                </p>
                <p className="font-medium text-foreground">This will irreversibly remove:</p>
                <ul className="list-disc ml-6 space-y-1 text-sm">
                  <li>Their login credentials (email and password)</li>
                  <li>Their profile and all personal data</li>
                  <li>All their exam attempts and results</li>
                  <li>All associated activity logs and records</li>
                </ul>
                <p className="text-destructive font-semibold pt-2">⚠️ This action cannot be undone!</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteUserMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteUser && deleteUserMutation.mutate(deleteUser.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteUserMutation.isPending}
            >
              {deleteUserMutation.isPending ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Password Reset Dialog */}
      <EditStudentPasswordDialog
        open={!!passwordResetUser}
        onOpenChange={(open) => !open && setPasswordResetUser(null)}
        student={passwordResetUser}
      />
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    super_admin: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    school_admin: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    coordinator: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    teacher: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    student: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };

  return (
    <Badge variant="outline" className={`${colors[role] || ""} capitalize`}>
      {role.replace(/_/g, " ")}
    </Badge>
  );
}

interface ResponsiveUsersListProps {
  users: any[];
  sortConfig: { key: string; direction: "asc" | "desc" };
  handleSort: (key: string) => void;
  onViewUser: (id: string) => void;
  onEditUser: (id: string) => void;
  onChangeRole: (user: any) => void;
  onResetPassword: (user: any) => void;
  onAssignSuperAdmin: (user: any) => void;
  onDeactivate: (id: string) => void;
  onDelete: (user: any) => void;
  currentPage: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: string) => void;
}

function ResponsiveUsersList({
  users,
  sortConfig,
  handleSort,
  onViewUser,
  onEditUser,
  onChangeRole,
  onResetPassword,
  onAssignSuperAdmin,
  onDeactivate,
  onDelete,
  currentPage,
  pageSize,
  totalCount,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: ResponsiveUsersListProps) {
  const isMobile = useIsMobile();

  const renderUserActions = (user: any) => (
    <>
      <DropdownMenuItem onClick={() => onViewUser(user.id)}>View Profile</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onEditUser(user.id)}>Edit</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onChangeRole(user)}>Change Role</DropdownMenuItem>
      <DropdownMenuItem onClick={() => onResetPassword(user)}>
        <Key className="h-4 w-4 mr-2" />
        Reset Password
      </DropdownMenuItem>
      {!user.roles?.includes("super_admin") && (
        <DropdownMenuItem onClick={() => onAssignSuperAdmin(user)} className="text-purple-600">
          Assign Super Admin
        </DropdownMenuItem>
      )}
      <DropdownMenuItem className="text-amber-600" onClick={() => onDeactivate(user.id)}>
        Deactivate
      </DropdownMenuItem>
      {!user.roles?.includes("super_admin") && (
        <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onDelete(user)}>
          <Trash2 className="h-4 w-4 mr-2" />
          Delete Permanently
        </DropdownMenuItem>
      )}
    </>
  );

  // Mobile Card View
  if (isMobile) {
    return (
      <div className="space-y-4">
        <MobileDataList>
          {users.map((user) => (
            <MobileDataCard
              key={user.id}
              title={user.full_name}
              subtitle={user.email}
              avatarText={user.full_name.substring(0, 2).toUpperCase()}
              badge={{
                text: user.primaryRole?.replace(/_/g, " ") || "User",
                className: getRoleBadgeClass(user.primaryRole),
              }}
              fields={[
                { label: "Institution", value: user.institutions?.name || "N/A" },
                {
                  label: "Status",
                  value: (
                    <Badge variant={user.is_active ? "default" : "secondary"} className="text-xs">
                      {user.is_active ? "Active" : "Inactive"}
                    </Badge>
                  ),
                },
              ]}
              actions={renderUserActions(user)}
              onClick={() => onViewUser(user.id)}
            />
          ))}
        </MobileDataList>

        {/* Mobile Pagination */}
        <div className="flex flex-col gap-3 items-center">
          <p className="text-sm text-muted-foreground">
            {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Prev
            </Button>
            <span className="text-sm px-2">
              {currentPage} / {totalPages || 1}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage >= totalPages}
            >
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Desktop Table View
  return (
    <div>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHeader
              label="User"
              sortKey="full_name"
              currentSortKey={sortConfig.key}
              currentDirection={sortConfig.direction}
              onSort={handleSort}
            />
            <SortableTableHeader
              label="Role"
              sortKey="primaryRole"
              currentSortKey={sortConfig.key}
              currentDirection={sortConfig.direction}
              onSort={handleSort}
            />
            <SortableTableHeader
              label="Institution"
              sortKey="institutions.name"
              currentSortKey={sortConfig.key}
              currentDirection={sortConfig.direction}
              onSort={handleSort}
            />
            <SortableTableHeader
              label="User Since"
              sortKey="created_at"
              currentSortKey={sortConfig.key}
              currentDirection={sortConfig.direction}
              onSort={handleSort}
            />
            <SortableTableHeader
              label="Status"
              sortKey="is_active"
              currentSortKey={sortConfig.key}
              currentDirection={sortConfig.direction}
              onSort={handleSort}
            />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((user) => (
            <TableRow key={user.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>{user.full_name.substring(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p
                      className="font-medium cursor-pointer hover:underline text-primary"
                      onClick={() => onViewUser(user.id)}
                    >
                      {user.full_name}
                    </p>
                    <p className="text-sm text-muted-foreground">{user.email}</p>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <RoleBadge role={user.primaryRole} />
              </TableCell>
              <TableCell className="text-muted-foreground">{user.institutions?.name || "N/A"}</TableCell>
              <TableCell className="text-muted-foreground text-sm">
                {user.created_at ? new Date(user.created_at).toLocaleDateString() : "N/A"}
              </TableCell>
              <TableCell>
                <Badge variant={user.is_active ? "default" : "secondary"}>
                  {user.is_active ? "Active" : "Inactive"}
                </Badge>
              </TableCell>
              <TableCell>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">{renderUserActions(user)}</DropdownMenuContent>
                </DropdownMenu>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {/* Desktop Pagination */}
      <div className="flex flex-col sm:flex-row items-center justify-between px-4 py-4 border-t gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span className="hidden sm:inline">Rows per page:</span>
          <SearchableSelect
            value={pageSize.toString()}
            onValueChange={onPageSizeChange}
            placeholder="Rows"
            searchPlaceholder="Search..."
            options={PAGE_SIZES.map((size) => ({
              value: size.toString(),
              label: size.toString(),
            }))}
            className="h-8 w-[80px]"
          />
          <span className="ml-2 sm:ml-4">
            {(currentPage - 1) * pageSize + 1}-{Math.min(currentPage * pageSize, totalCount)} of {totalCount}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages || 1}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function getRoleBadgeClass(role: string) {
  const colors: Record<string, string> = {
    super_admin: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300",
    school_admin: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300",
    coordinator: "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
    teacher: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300",
    student: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return colors[role] || "";
}

function PageSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-64 mt-2" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid gap-4 grid-cols-2 md:grid-cols-4">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </div>
  );
}
