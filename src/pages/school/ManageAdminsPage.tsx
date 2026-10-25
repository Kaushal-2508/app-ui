import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { logActivityEvent } from "@/lib/activityLog";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { revokeTeacherRole } from "@/lib/staffAssignments";
import { AssignTeacherClassSubjectDialog } from "@/components/school/AssignTeacherClassSubjectDialog";
import { Plus, Trash2, UserCog, Mail, Calendar, Shield, Users, Check, Pencil, Crown, ArrowUpCircle, ArrowDownCircle, MoreHorizontal, GraduationCap, AlertTriangle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { formatNumber } from "@/lib/formatNumber";
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { ClayStatTile, ListRow, EmptyState } from "@/components/shared/surfaces";
import { MobileSheet } from "@/components/shared/sheets";

const DESIGNATION_OPTIONS = ["Principal", "Vice-Principal", "Owner", "Custom"] as const;

interface AdminUser {
  id: string;
  full_name: string;
  email: string;
  is_active: boolean;
  created_at: string;
  avatar_path: string | null;
  admin_title: string | null;
  role_id: string;
  role: string;
  /** Also holds the teacher role in this institution. */
  is_teacher: boolean;
  /** Holds any non-admin role, so removing admin must not delete the account. */
  has_other_role: boolean;
}

export default function ManageAdminsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { institutionId, isLoading: institutionLoading } = useEffectiveInstitution();
  const { data: currentUser } = useUserRole();
  const { user: me } = useAuth();
  
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  // The sheet's primary button lives in its footer, outside the <form>, so it
  // submits through requestSubmit() and keeps the browser's required checks.
  const addFormRef = useRef<HTMLFormElement>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedAdmin, setSelectedAdmin] = useState<AdminUser | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  // Admin + teacher dual role
  const [grantTeacherFor, setGrantTeacherFor] = useState<AdminUser | null>(null);
  const [revokeTeacherFor, setRevokeTeacherFor] = useState<AdminUser | null>(null);

  // Edit designation state
  const [editDesignationOpen, setEditDesignationOpen] = useState(false);
  const [editingAdmin, setEditingAdmin] = useState<AdminUser | null>(null);
  const [editDesignation, setEditDesignation] = useState("");
  const [editCustomTitle, setEditCustomTitle] = useState("");
  
  // Create form state
  const [formData, setFormData] = useState({
    fullName: "",
    email: "",
    password: "",
  });
  const [designation, setDesignation] = useState("");
  const [customTitle, setCustomTitle] = useState("");

  // Fetch all school_admins for this institution
  const { data: admins, isLoading: adminsLoading, error: adminsError } = useQuery({
    queryKey: ["institution-admins", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];
      
      // Get all users with school_admin or super_school_admin role for this institution
      const { data: adminRoles, error: rolesError } = await supabase
        .from("user_roles")
        .select("id, user_id, admin_title, role")
        .in("role", ["school_admin", "super_school_admin"])
        .eq("institution_id", institutionId);
      
      if (rolesError) throw rolesError;
      if (!adminRoles?.length) return [];
      
      const userIds = adminRoles.map(r => r.user_id);
      
      const { data: profiles, error: profilesError } = await supabase
        .from("profiles")
        .select("id, full_name, email, is_active, created_at, avatar_path")
        .in("id", userIds)
        .order("created_at", { ascending: true });
      
      if (profilesError) throw profilesError;

      // An admin may also hold teacher or coordinator. That changes two things
      // on this page: the row shows a Teacher badge, and "Remove admin" must
      // revoke the role instead of deleting an account that still teaches.
      const { data: otherRoles, error: otherRolesError } = await supabase
        .from("user_roles")
        .select("user_id, role")
        .in("user_id", userIds)
        .in("role", ["teacher", "coordinator"])
        .eq("institution_id", institutionId)
        .range(0, 999);

      if (otherRolesError) throw otherRolesError;

      // Merge admin_title and role from roles into profile data
      return (profiles || []).map(p => {
        const role = adminRoles.find(r => r.user_id === p.id);
        const mine = (otherRoles || []).filter(r => r.user_id === p.id);
        return {
          ...p,
          admin_title: (role as { admin_title?: string | null } | undefined)?.admin_title || null,
          role_id: role?.id || "",
          role: role?.role || "school_admin",
          is_teacher: mine.some(r => r.role === "teacher"),
          has_other_role: mine.length > 0,
        };
      }) as AdminUser[];
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });

  // Create admin mutation
  const createAdminMutation = useMutation({
    mutationFn: async (data: { fullName: string; email: string; password: string; designation: string }) => {
      const result = await invokeAdminOperation<{ userId: string; email: string; password: string }>({
        action: "create_user",
        data: {
          email: data.email.trim(),
          fullName: data.fullName.trim(),
          password: data.password,
          role: "school_admin",
          institutionId,
        },
      });

      // Update admin_title if a designation was selected
      if (data.designation && result.userId) {
        const { error: updateError } = await supabase
          .from("user_roles")
          .update({ admin_title: data.designation })
          .eq("user_id", result.userId)
          .eq("role", "school_admin");

        if (updateError) console.error("Failed to set admin title:", updateError);
      }

      return result;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["institution-admins"] });
      setCreatedCredentials({ email: result.email, password: result.password });
      toast({
        title: "Admin Created",
        description: `${result.email} has been added as an administrator`,
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't create admin.", context: "createAdmin" }),
  });

  // Update designation mutation
  const updateDesignationMutation = useMutation({
    mutationFn: async ({ roleId, title }: { roleId: string; title: string | null }) => {
      const { error } = await supabase
        .from("user_roles")
        .update({ admin_title: title })
        .eq("id", roleId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-admins"] });
      setEditDesignationOpen(false);
      setEditingAdmin(null);
      toast({
        title: "Designation Updated",
        description: "Admin designation has been updated successfully",
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update the designation.", context: "updateDesignation" }),
  });

  // Remove admin mutation.
  //
  // This button has always said "they will lose all admin privileges but their
  // account will remain active", while actually calling delete_user, which
  // permanently deletes the auth account and cascades every row they own. That
  // was survivable while admins were only admins. Now that an admin can also
  // teach, one click would destroy a working teacher's exams, attempts and
  // assignments, so the two cases are split:
  //   - admin-only target  -> unchanged, still deletes the account
  //   - also teaches/coords -> revoke just the admin role row
  const deleteAdminMutation = useMutation({
    mutationFn: async (admin: AdminUser) => {
      if (admin.has_other_role) {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("id", admin.role_id);
        if (error) throw error;

        // A DELETE blocked by RLS is indistinguishable from success (empty
        // data, no error), so re-SELECT and treat "row gone" as the only
        // proof of success.
        const { data: still, error: checkError } = await supabase
          .from("user_roles")
          .select("id")
          .eq("id", admin.role_id)
          .maybeSingle();
        if (checkError) throw checkError;
        if (still) throw new Error("You do not have permission to remove that administrator.");

        // The delete_user branch below is logged server-side by admin-operations;
        // this revoke-only branch is a plain row delete, so record it here.
        void logActivityEvent({
          action: "admin_role_revoked",
          entityType: "User",
          entityId: admin.id,
          entityName: admin.full_name,
          oldValues: { role: admin.role, admin_title: admin.admin_title, email: admin.email },
          metadata: { institution_id: institutionId ?? null },
        });
        return { revokedOnly: true };
      }

      await invokeAdminOperation<{ success: boolean }>({
        action: "delete_user",
        data: { userId: admin.id },
      });
      return { revokedOnly: false };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["institution-admins"] });
      queryClient.invalidateQueries({ queryKey: ["user-role-info"] });
      setDeleteDialogOpen(false);
      setSelectedAdmin(null);
      toast({
        title: result.revokedOnly ? "Admin access removed" : "Admin removed",
        description: result.revokedOnly
          ? "They keep their account and their other roles."
          : "The administrator has been removed from your institution",
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't remove admin.", context: "deleteAdmin" }),
  });

  // Remove the teacher role and the teaching assignments that came with it,
  // in one audited transaction. Without this the grant would be a one-way
  // door: nothing else in the app revokes a single user_roles row.
  const revokeTeacherMutation = useMutation({
    mutationFn: async (userId: string) => revokeTeacherRole(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-admins"] });
      queryClient.invalidateQueries({ queryKey: ["user-role-info"] });
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      setRevokeTeacherFor(null);
      toast({
        title: "Teacher role removed",
        description: "They keep full administrator access.",
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't remove the teacher role.", context: "revokeTeacherRole" }),
  });

  // Promote/demote mutation
  const promoteAdminMutation = useMutation({
    mutationFn: async ({ roleId, newRole }: { roleId: string; newRole: "school_admin" | "super_school_admin" }) => {
      const { error } = await supabase
        .from("user_roles")
        .update({ role: newRole })
        .eq("id", roleId);
      
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["institution-admins"] });
      queryClient.invalidateQueries({ queryKey: ["user-role-info"] });
      const action = variables.newRole === "super_school_admin" ? "promoted to Owner" : "changed to Admin";
      toast({
        title: "Role Updated",
        description: `Administrator has been ${action}`,
      });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update the role.", context: "promoteAdmin" }),
  });

  const getEffectiveDesignation = () => {
    if (designation === "Custom") return customTitle.trim() || null;
    return designation || null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.fullName || !formData.email || !formData.password) {
      toast({
        title: "Missing fields",
        description: "Please fill in all required fields",
        variant: "destructive",
      });
      return;
    }
    
    if (formData.password.length < 6) {
      toast({
        title: "Password too short",
        description: "Password must be at least 6 characters",
        variant: "destructive",
      });
      return;
    }
    
    createAdminMutation.mutate({
      ...formData,
      designation: getEffectiveDesignation() || "",
    });
  };

  const handleDeleteClick = (admin: AdminUser) => {
    setSelectedAdmin(admin);
    setDeleteDialogOpen(true);
  };

  const handleEditDesignation = (admin: AdminUser) => {
    setEditingAdmin(admin);
    const title = admin.admin_title || "";
    const isPreset = (DESIGNATION_OPTIONS.slice(0, 3) as readonly string[]).includes(title);
    if (isPreset) {
      setEditDesignation(title);
      setEditCustomTitle("");
    } else if (title) {
      setEditDesignation("Custom");
      setEditCustomTitle(title);
    } else {
      setEditDesignation("");
      setEditCustomTitle("");
    }
    setEditDesignationOpen(true);
  };

  const handleSaveDesignation = () => {
    if (!editingAdmin) return;
    let title: string | null = null;
    if (editDesignation === "Custom") {
      title = editCustomTitle.trim() || null;
    } else if (editDesignation) {
      title = editDesignation;
    }
    updateDesignationMutation.mutate({ roleId: editingAdmin.role_id, title });
  };

  const handleCopy = () => {
    if (createdCredentials) {
      navigator.clipboard.writeText(
        `Email: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({
        title: "Copied",
        description: "Credentials copied to clipboard",
      });
    }
  };

  const handleCloseDialog = () => {
    setAddDialogOpen(false);
    setCreatedCredentials(null);
    setFormData({ fullName: "", email: "", password: "" });
    setDesignation("");
    setCustomTitle("");
  };

  const canPromote = currentUser?.isSuperAdmin || currentUser?.isSuperSchoolAdmin;

  const isLoading = institutionLoading || adminsLoading;
  // Counts over the list already on screen (a school has a handful of
  // admins; this is the whole list, not a page of it).
  const list = admins ?? [];
  const counts = {
    total: list.length,
    active: list.filter((a) => a.is_active).length,
    owners: list.filter((a) => a.role === "super_school_admin").length,
  };
  const stat = (n: number) => (adminsError ? "N/A" : formatNumber(n));

  return (
    <PageShell
      fab={
        <MobileFab
          label="Add Administrator"
          icon={<Plus className="h-6 w-6" />}
          onClick={() => setAddDialogOpen(true)}
        />
      }
    >
      <PageHeader
        icon={<Shield className="h-5 w-5" />}
        title="Manage Administrators"
        subtitle="Add or remove peer administrators for your institution. All admins have equal powers."
        primaryAction={{
          label: "Add Administrator",
          icon: <Plus className="h-4 w-4" />,
          onClick: () => setAddDialogOpen(true),
        }}
      />

      {/* A failed read must never render as a confident zero (§6): the tiles
          show "N/A" rather than 0 when the query errored. Three clay tiles,
          the dashboard's style (Naman, 2026-10-07: "I want that style in
          here"), one row from sm up, each in its own tone. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <ClayStatTile label="Total admins" value={stat(counts.total)} icon={<Users />} tone="teal" />
        <ClayStatTile label="Active" value={stat(counts.active)} icon={<Shield />} tone="mint" />
        <ClayStatTile label="Owners" value={stat(counts.owners)} icon={<Crown />} tone="peach" />
      </div>

      <div className="mt-4 surface-card frosted-shadow rounded-2xl p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold text-ink-900">Administrators</h2>
          <p className="text-sm text-ink-600">
            All administrators can create, edit, and remove other admins.
          </p>
        </div>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : adminsError ? (
          // Error BEFORE empty (§6). A blocked or failed read resolving as
          // zero rows would otherwise read as "this school has no admins".
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            title="Couldn't load administrators"
            description="Something went wrong fetching the administrator list. Check your connection and try again."
          />
        ) : !admins?.length ? (
          <EmptyState
            icon={<UserCog className="h-7 w-7" />}
            title="No administrators yet"
            description="Add your first peer administrator to share institution-management duties."
            action={{
              label: "Add Administrator",
              icon: <Plus className="h-4 w-4" />,
              onClick: () => setAddDialogOpen(true),
            }}
          />
        ) : (
          <ul className="list-none p-0 space-y-2">
            {admins.map((admin) => {
              const isOwner = admin.role === "super_school_admin";
              const isLastAdmin = admins.length === 1;
              return (
                <ListRow
                  key={admin.id}
                  as="li"
                  className="transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-card-lg"
                  leading={
                    // The ring says the role at a glance: amber for the owner,
                    // teal for an admin, before the badges are read.
                    <UserAvatar
                      name={admin.full_name}
                      email={admin.email}
                      avatarPath={admin.avatar_path}
                      className={cn(
                        "h-10 w-10 shrink-0 ring-2 ring-offset-2 ring-offset-[hsl(var(--surface-card))]",
                        isOwner ? "ring-amber-400/70" : "ring-brand-primary/30",
                      )}
                      fallbackClassName={cn(
                        "text-sm font-semibold",
                        isOwner ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-brand-primary/10 text-brand-primary",
                      )}
                    />
                  }
                  title={
                    <span className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">{admin.full_name}</span>
                      {isOwner ? (
                        <Badge className="bg-gradient-to-r from-amber-500 to-orange-500 text-white border-0 text-xs">
                          <Crown className="h-3 w-3 mr-1" />
                          Owner
                        </Badge>
                      ) : (
                        <Badge className="border-0 bg-brand-primary/10 text-xs text-brand-primary hover:bg-brand-primary/10">Admin</Badge>
                      )}
                      {me?.id === admin.id && (
                        <Badge variant="secondary" className="text-[10px]">You</Badge>
                      )}
                      {admin.admin_title && (
                        <Badge variant="secondary" className="text-xs">{admin.admin_title}</Badge>
                      )}
                      {admin.is_teacher && (
                        <Badge className="gap-1 border-0 bg-brand-secondary/10 text-xs text-brand-secondary hover:bg-brand-secondary/10">
                          <GraduationCap className="h-3 w-3" />
                          Teacher
                        </Badge>
                      )}
                      {!admin.is_active && (
                        <Badge className="border-0 bg-rose-500/10 text-xs text-rose-600 hover:bg-rose-500/10">Inactive</Badge>
                      )}
                    </span>
                  }
                  subtitle={
                    // Two lines on a phone (the e-mail was squeezed to "me@..."
                    // beside the date at 375px), one line from sm up.
                    <span className="text-xs text-ink-600">
                      <span className="block truncate sm:inline">{admin.email}</span>
                      <span className="hidden sm:inline"> · </span>
                      <span className="mt-0.5 inline-flex items-center gap-1 sm:mt-0">
                        <Calendar className="h-3 w-3" />
                        Joined {format(new Date(admin.created_at), "MMM d, yyyy")}
                      </span>
                    </span>
                  }
                  trailing={
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {canPromote && admin.role === "school_admin" && (
                          <DropdownMenuItem
                            onClick={() => promoteAdminMutation.mutate({ roleId: admin.role_id, newRole: "super_school_admin" })}
                          >
                            <ArrowUpCircle className="h-4 w-4 mr-2 text-amber-500" />
                            Promote to Owner
                          </DropdownMenuItem>
                        )}
                        {canPromote && admin.role === "super_school_admin" && (
                          <DropdownMenuItem
                            onClick={() => promoteAdminMutation.mutate({ roleId: admin.role_id, newRole: "school_admin" })}
                          >
                            <ArrowDownCircle className="h-4 w-4 mr-2" />
                            Demote to Admin
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onClick={() => handleEditDesignation(admin)}>
                          <Pencil className="h-4 w-4 mr-2" />
                          Edit designation
                        </DropdownMenuItem>
                        {admin.is_teacher ? (
                          <DropdownMenuItem onClick={() => setRevokeTeacherFor(admin)}>
                            <GraduationCap className="h-4 w-4 mr-2" />
                            Remove from teacher
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem onClick={() => setGrantTeacherFor(admin)}>
                            <GraduationCap className="h-4 w-4 mr-2" />
                            Add to teacher
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          disabled={isLastAdmin}
                          onClick={() => handleDeleteClick(admin)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          {isLastAdmin ? "Cannot remove last admin" : "Remove admin"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  }
                />
              );
            })}
          </ul>
        )}
      </div>


      {/* Add Administrator. A bottom sheet on phones (thumb-reachable, slides
          up from the FAB the user just tapped), a centred floating panel on
          sm+. Two states share the sheet: the form, then the one-time
          credentials once the account exists. */}
      <MobileSheet
        open={addDialogOpen}
        onOpenChange={(open) => {
          if (open) {
            setAddDialogOpen(true);
            return;
          }
          // Swipe-down or X while the account is being created would leave
          // the user guessing whether it went through; the button owns the
          // spinner until the mutation settles.
          if (createAdminMutation.isPending) return;
          handleCloseDialog();
        }}
        desktopWidth="md"
        icon={createdCredentials ? <Check className="h-4 w-4" /> : <Shield className="h-4 w-4" />}
        title={createdCredentials ? "Administrator created" : "Add New Administrator"}
        subtitle={
          createdCredentials
            ? "Save these credentials, they won't be shown again."
            : "They will have the same powers as you."
        }
        primaryAction={
          createdCredentials
            ? { label: "Done", onClick: handleCloseDialog }
            : {
                label: "Create Administrator",
                onClick: () => addFormRef.current?.requestSubmit(),
                loading: createAdminMutation.isPending,
              }
        }
        secondaryAction={
          createdCredentials
            ? { label: copied ? "Copied!" : "Copy Credentials", onClick: handleCopy }
            : { label: "Cancel", onClick: handleCloseDialog, disabled: createAdminMutation.isPending }
        }
      >
        {!createdCredentials ? (
          <form ref={addFormRef} onSubmit={handleSubmit} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="fullName" className="text-ink-700">Full Name *</Label>
              <Input
                id="fullName"
                value={formData.fullName}
                onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                placeholder="John Smith"
                autoComplete="off"
                className="h-11"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email" className="text-ink-700">Email *</Label>
              <Input
                id="email"
                type="email"
                inputMode="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="admin@school.edu"
                autoComplete="off"
                className="h-11"
                required
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="password" className="text-ink-700">Password *</Label>
              <PasswordInput
                id="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Min 6 characters"
                autoComplete="new-password"
                className="h-11"
                required
                minLength={6}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="designation" className="text-ink-700">Designation</Label>
              <Select value={designation} onValueChange={(val) => { setDesignation(val); if (val !== "Custom") setCustomTitle(""); }}>
                <SelectTrigger id="designation" className="h-11">
                  <SelectValue placeholder="Select designation (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {DESIGNATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {designation === "Custom" && (
                <Input
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Enter custom title"
                  className="mt-1 h-11"
                />
              )}
            </div>
          </form>
        ) : (
          <div className="rounded-card border border-brand-primary/20 bg-brand-primary/5 p-4 space-y-3">
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                <Mail className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="eyebrow">Email</p>
                <p className="truncate font-medium text-ink-900">{createdCredentials.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                <Shield className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="eyebrow">Password</p>
                <code className="block truncate rounded-md bg-surface-card px-2 py-1 text-sm text-ink-900">
                  {createdCredentials.password}
                </code>
              </div>
            </div>
          </div>
        )}
      </MobileSheet>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedAdmin?.has_other_role ? "Remove admin access" : "Delete this account"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedAdmin?.has_other_role ? (
                <>
                  Remove <strong>{selectedAdmin?.full_name}</strong> as an administrator? They keep
                  their account and their other roles, and lose admin access only.
                </>
              ) : (
                <>
                  Remove <strong>{selectedAdmin?.full_name}</strong>? This permanently deletes their
                  account and everything they created. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => selectedAdmin && deleteAdminMutation.mutate(selectedAdmin)}
              disabled={deleteAdminMutation.isPending}
            >
              {deleteAdminMutation.isPending
                ? "Removing..."
                : selectedAdmin?.has_other_role
                  ? "Remove admin access"
                  : "Delete account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Designation */}
      <MobileSheet
        open={editDesignationOpen}
        onOpenChange={(open) => {
          if (!open && updateDesignationMutation.isPending) return;
          setEditDesignationOpen(open);
        }}
        desktopWidth="md"
        icon={<Pencil className="h-4 w-4" />}
        title="Edit Designation"
        subtitle={editingAdmin ? `Change the designation for ${editingAdmin.full_name}` : undefined}
        primaryAction={{
          label: "Save",
          onClick: handleSaveDesignation,
          loading: updateDesignationMutation.isPending,
        }}
        secondaryAction={{
          label: "Cancel",
          onClick: () => setEditDesignationOpen(false),
          disabled: updateDesignationMutation.isPending,
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="editDesignation" className="text-ink-700">Designation</Label>
          <Select value={editDesignation} onValueChange={(val) => { setEditDesignation(val); if (val !== "Custom") setEditCustomTitle(""); }}>
            <SelectTrigger id="editDesignation" className="h-11">
              <SelectValue placeholder="Select designation" />
            </SelectTrigger>
            <SelectContent>
              {DESIGNATION_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {editDesignation === "Custom" && (
            <Input
              value={editCustomTitle}
              onChange={(e) => setEditCustomTitle(e.target.value)}
              placeholder="Enter custom title"
              className="mt-1 h-11"
            />
          )}
        </div>
      </MobileSheet>

      {/* Add to teacher. Reuses the teacher assignment picker (same class and
          subject tree, same AddSubjectPopover, same dual-table write path) but
          with grantRole, so the save goes through grant_teacher_role and adds
          the role and the assignments in ONE audited transaction. */}
      {grantTeacherFor && institutionId && (
        <AssignTeacherClassSubjectDialog
          open={!!grantTeacherFor}
          onOpenChange={(open) => !open && setGrantTeacherFor(null)}
          user={{ id: grantTeacherFor.id, full_name: grantTeacherFor.full_name }}
          institutionId={institutionId}
          grantRole
        />
      )}

      {/* Remove from teacher */}
      <AlertDialog
        open={!!revokeTeacherFor}
        onOpenChange={(open) => !open && setRevokeTeacherFor(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the teacher role</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{revokeTeacherFor?.full_name}</strong> will stop teaching: their class and
              subject assignments are removed, and the Teacher view disappears. They keep full
              administrator access. Exams and homework they already created stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeTeacherMutation.isPending}
              onClick={() => revokeTeacherFor && revokeTeacherMutation.mutate(revokeTeacherFor.id)}
            >
              {revokeTeacherMutation.isPending ? "Removing..." : "Remove teacher role"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
