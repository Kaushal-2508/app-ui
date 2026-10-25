import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/shared/UserAvatar";
import {
  UserCog,
  Plus,
  Search,
  MoreHorizontal,
  Layers,
  Building2,
  GraduationCap,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";
import { useAuth } from "@/contexts/AuthContext";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { useNavigate } from "react-router-dom";
import { AddUserDialog } from "@/components/admin/AddUserDialog";
import { ViewUserSheet } from "@/components/admin/ViewUserSheet";
import { AssignClassesDialog } from "@/components/school/AssignClassesDialog";
import { AssignWingDialog } from "@/components/school/AssignWingDialog";
import { formatNumber } from "@/lib/formatNumber";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { ClayStatTile, ListRow, EmptyState } from "@/components/shared/surfaces";

type WingRef = { id: string; name: string };
type ClassRef = { id: string; name: string; section: string | null; is_active: boolean };
type WingAssignmentRow = {
  user_id: string;
  wing_id: string;
  wings: WingRef | WingRef[] | null;
};
type WingClassMappingRow = {
  wing_id: string;
  class_id: string;
  classes: ClassRef | ClassRef[] | null;
};
type CoordinatorWingClass = { class_id: string; name: string; section: string | null };

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default function SchoolCoordinatorsPage() {
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [viewUserOpen, setViewUserOpen] = useState(false);
  const [assignClassesOpen, setAssignClassesOpen] = useState(false);
  const [assignWingOpen, setAssignWingOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<{ id: string; full_name: string } | null>(null);

  // Ref to programmatically trigger the AddUserDialog hidden button
  const addCoordinatorTriggerRef = useRef<HTMLButtonElement>(null);
  const handleAddCoordinator = () => addCoordinatorTriggerRef.current?.click();

  const [deleteTarget, setDeleteTarget] = useState<
    { id: string; full_name: string; isAlsoTeacher: boolean } | null
  >(null);

  const { data: roleInfo } = useUserRole();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // admin-operations lets only school admins (incl. super school admins) and
  // super admins delete a coordinator; coordinators and staff-manager override
  // holders are refused server-side, so the option is hidden from them here.
  const canDeleteCoordinators = !!(roleInfo?.isSchoolAdmin || roleInfo?.isSuperAdmin);

  const deleteCoordinatorMutation = useMutation({
    mutationFn: (userId: string) =>
      invokeAdminOperation({ action: "delete_user", data: { userId } }),
    onSuccess: () => {
      toast.success(`${deleteTarget?.full_name || "The coordinator"} was deleted.`);
      queryClient.invalidateQueries({ queryKey: ["school-coordinators"] });
      // A dual-role coordinator also disappears from the Teachers tab.
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      setDeleteTarget(null);
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't delete this coordinator.", context: "deleteCoordinator" }),
  });

  const { data: coordinators, isLoading, error: coordinatorsError, refetch } = useQuery({
    queryKey: ["school-coordinators", roleInfo?.institutionId],
    queryFn: async () => {
      if (!roleInfo?.institutionId) return [];

      const { data: coordinatorRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("institution_id", roleInfo.institutionId)
        .eq("role", "coordinator");

      if (rolesError) throw rolesError;
      if (!coordinatorRoles || coordinatorRoles.length === 0) return [];

      const userIds = coordinatorRoles.map(r => r.user_id);

      const { data: allRoles } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds)
        .in("role", ["teacher", "coordinator"]);

      const teacherRoleMap = new Map<string, boolean>();
      allRoles?.forEach(r => {
        if (r.role === "teacher") {
          teacherRoleMap.set(r.user_id, true);
        }
      });

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .in("id", userIds)
        .order("full_name");

      if (error) throw error;

      const { data: wingAssignments } = await supabase
        .from("wing_assignments")
        .select(`
          user_id,
          wing_id,
          wings:wing_id (id, name)
        `)
        .in("user_id", userIds);

      // Get all wing IDs across all coordinators
      const allWingIds = [...new Set(wingAssignments?.map(wa => wa.wing_id) || [])] as string[];

      // Fetch wing_class_mappings for those wings to derive unique classes
      const wingClassMap = new Map<string, CoordinatorWingClass[]>();
      if (allWingIds.length > 0) {
        const { data: wcMappings } = await supabase
          .from("wing_class_mappings")
          .select(`
            wing_id,
            class_id,
            classes:class_id (id, name, section, is_active)
          `)
          .in("wing_id", allWingIds);

        // Build wing_id -> classes map
        (wcMappings as WingClassMappingRow[] | null)?.forEach((wcm) => {
          const cls = pickOne(wcm.classes);
          if (cls && cls.is_active) {
            const existing = wingClassMap.get(wcm.wing_id) || [];
            existing.push({ class_id: wcm.class_id, name: cls.name, section: cls.section });
            wingClassMap.set(wcm.wing_id, existing);
          }
        });
      }

      const typedWingAssignments = (wingAssignments as WingAssignmentRow[] | null) || [];

      const coordinatorsWithWings = (data || []).map(coord => {
        const userWingAssignments = typedWingAssignments.filter(wa => wa.user_id === coord.id);
        const userWings = userWingAssignments
          .map((wa) => pickOne(wa.wings))
          .filter((w): w is WingRef => Boolean(w));

        // Derive unique classes from coordinator's wings
        const classMap = new Map<string, { name: string; section: string | null }>();
        userWingAssignments.forEach(wa => {
          const classes = wingClassMap.get(wa.wing_id) || [];
          classes.forEach(cls => {
            classMap.set(cls.class_id, { name: cls.name, section: cls.section });
          });
        });
        const wingClasses = [...classMap.entries()].map(([class_id, info]) => ({
          class_id,
          name: info.name,
          section: info.section,
        }));

        return {
          ...coord,
          wing_assignments: userWings,
          wingClasses,
          isAlsoTeacher: teacherRoleMap.get(coord.id) || false,
        };
      });

      return coordinatorsWithWings;
    },
    enabled: !!roleInfo?.institutionId,
  });

  const filteredCoordinators = coordinators?.filter((coordinator) => {
    return coordinator.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      coordinator.email?.toLowerCase().includes(search.toLowerCase());
  });

  const totalClassesAssigned = new Set(
    coordinators?.flatMap(c =>
      (c.wingClasses || []).map((wc) => wc.class_id)
    ) || []
  ).size;

  const handleViewProfile = (userId: string) => {
    setSelectedUserId(userId);
    setViewUserOpen(true);
  };

  const handleAssignClasses = (user: { id: string; full_name: string }) => {
    setSelectedUser(user);
    setAssignClassesOpen(true);
  };

  const handleViewTasks = (userId: string) => {
    navigate(`/tasks?assignedTo=${userId}`);
  };

  const handleAssignWing = (user: { id: string; full_name: string }) => {
    setSelectedUser(user);
    setAssignWingOpen(true);
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  return (
    <PageShell
      fab={
        <MobileFab
          label="Add Coordinator"
          icon={<Plus className="h-6 w-6" />}
          onClick={handleAddCoordinator}
        />
      }
    >
      <PageHeader
        icon={<UserCog className="h-5 w-5" />}
        title="Coordinators"
        subtitle="Manage your school's coordinators"
        primaryAction={{
          label: "Add Coordinator",
          icon: <Plus className="h-4 w-4" />,
          onClick: handleAddCoordinator,
        }}
      />

      {/* The dashboard's clay tiles, as on the Admins tab (Naman, 2026-10-07:
          "also do for this"). "N/A" on a failed read, never a confident 0. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        <ClayStatTile
          label="Total coordinators"
          value={coordinatorsError ? "N/A" : formatNumber(coordinators?.length || 0)}
          icon={<UserCog />}
          tone="teal"
        />
        <ClayStatTile
          label="Unique classes assigned"
          value={coordinatorsError ? "N/A" : formatNumber(totalClassesAssigned)}
          icon={<Layers />}
          tone="violet"
        />
      </div>

      {/* Search: a card-coloured field with a hairline and a shadow, so it
          stands off the cream backdrop (Naman, 2026-10-07: "mixed up with
          background"). */}
      <div className="mt-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search coordinators..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-11 rounded-xl pl-9 border-[hsl(var(--surface-stroke))] bg-[hsl(var(--surface-card))] shadow-card placeholder:text-ink-500 focus-visible:ring-brand-primary/40"
          />
        </div>
      </div>

      {/* List */}
      <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
        <h2 className="text-base font-semibold text-ink-900">Coordinators</h2>
        {coordinatorsError ? (
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            title="Couldn't load coordinators"
            description="Check your connection and try again."
            action={{ label: "Try again", onClick: () => refetch() }}
          />
        ) : filteredCoordinators?.length === 0 ? (
          <EmptyState
            icon={<UserCog className="h-7 w-7" />}
            title="No coordinators yet"
            description="Coordinators help admins manage classes and oversight. Add one to get started."
            action={{
              label: "Add Coordinator",
              icon: <Plus className="h-4 w-4" />,
              onClick: handleAddCoordinator,
            }}
          />
        ) : (
          <ul className="list-none p-0 space-y-2">
            {filteredCoordinators?.map((coordinator) => {
              const wings = coordinator.wing_assignments || [];
              const wingClasses = coordinator.wingClasses || [];
              return (
                <ListRow
                  key={coordinator.id}
                  as="li"
                  leading={
                    <UserAvatar
                      name={coordinator.full_name}
                      email={coordinator.email}
                      avatarPath={coordinator.avatar_path}
                      className="h-10 w-10"
                    />
                  }
                  title={
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{coordinator.full_name || "Unnamed"}</span>
                      {coordinator.isAlsoTeacher && (
                        <Badge variant="outline" className="text-xs border-green-200 text-green-700">
                          <GraduationCap className="h-3 w-3 mr-1" />
                          Teacher
                        </Badge>
                      )}
                      {!coordinator.is_active && <Badge variant="secondary" className="text-xs">Inactive</Badge>}
                    </span>
                  }
                  subtitle={
                    <span className="flex flex-col gap-1 text-xs text-ink-600">
                      <span className="truncate">{coordinator.email}</span>
                      <span className="flex items-center gap-1 flex-wrap">
                        <Building2 className="h-3 w-3" />
                        {wings.length === 0
                          ? "No wing assigned"
                          : wings.length === 1
                            ? wings[0].name
                            : `${wings[0].name} +${wings.length - 1}`}
                        {" · "}
                        <Layers className="h-3 w-3" />
                        {wingClasses.length === 0
                          ? "No classes"
                          : `${wingClasses.length} classes`}
                      </span>
                    </span>
                  }
                  onClick={() => handleViewProfile(coordinator.id)}
                  trailing={
                    // stopPropagation on the content prevents menu-item
                    // clicks from bubbling through React's tree to the
                    // ListRow's outer onClick (handleViewProfile), which
                    // would otherwise paint the View Profile sheet on
                    // top of whatever the menu item actually opened.
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <DropdownMenuItem onClick={() => handleViewProfile(coordinator.id)}>
                          View Profile
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleAssignWing({ id: coordinator.id, full_name: coordinator.full_name })}>
                          <Building2 className="h-4 w-4 mr-2" />
                          Assign to Wing
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleAssignClasses({ id: coordinator.id, full_name: coordinator.full_name })}>
                          <Layers className="h-4 w-4 mr-2" />
                          Assign Classes
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleViewTasks(coordinator.id)}>
                          View Tasks
                        </DropdownMenuItem>
                        {canDeleteCoordinators && coordinator.id !== user?.id && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={() =>
                                setDeleteTarget({
                                  id: coordinator.id,
                                  full_name: coordinator.full_name || "this coordinator",
                                  isAlsoTeacher: coordinator.isAlsoTeacher,
                                })
                              }
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Coordinator
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* Hidden trigger for AddUserDialog */}
      <div className="sr-only" aria-hidden>
        <AddUserDialog
          defaultInstitutionId={roleInfo?.institutionId}
          defaultRole="coordinator"
          allowedRoles={["coordinator"]}
          trigger={
            <button
              ref={addCoordinatorTriggerRef}
              type="button"
              tabIndex={-1}
              aria-hidden
            />
          }
        />
      </div>

      {/* Existing dialogs/sheets — UNCHANGED */}
      <ViewUserSheet open={viewUserOpen} onOpenChange={setViewUserOpen} userId={selectedUserId} />
      {roleInfo?.institutionId && (
        <>
          <AssignClassesDialog
            open={assignClassesOpen}
            onOpenChange={setAssignClassesOpen}
            user={selectedUser}
            institutionId={roleInfo.institutionId}
            role="coordinator"
          />
          <AssignWingDialog
            open={assignWingOpen}
            onOpenChange={setAssignWingOpen}
            user={selectedUser}
            institutionId={roleInfo.institutionId}
          />
        </>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open && !deleteCoordinatorMutation.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleteTarget?.full_name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the account. They will no longer be able to sign in, and
              their wing and class assignments are removed.
              {deleteTarget?.isAlsoTeacher &&
                " They are also a teacher, so their teacher access and teaching assignments are removed too."}{" "}
              Exams, marks and homework they created stay in the system without their name. This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCoordinatorMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteCoordinatorMutation.isPending}
              onClick={(e) => {
                // Keep the dialog open until the delete settles, so "Deleting..."
                // is visible and a second click can't fire a second request.
                e.preventDefault();
                if (deleteTarget && !deleteCoordinatorMutation.isPending) {
                  deleteCoordinatorMutation.mutate(deleteTarget.id);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCoordinatorMutation.isPending ? "Deleting..." : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}

function PageSkeleton() {
  return (
    <PageShell>
      <div className="space-y-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-64 mt-2" />
          </div>
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24 rounded-2xl" />
          <Skeleton className="h-24 rounded-2xl" />
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    </PageShell>
  );
}
