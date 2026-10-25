import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertTriangle } from "lucide-react";
import { useMutation, useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { logActivityEvent } from "@/lib/activityLog";
import { useToast } from "@/hooks/use-toast";

interface ChangeRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  userName: string;
}

type AppRole = "super_admin" | "super_school_admin" | "school_admin" | "coordinator" | "teacher" | "student";

const ROLES: { value: AppRole; label: string; description: string }[] = [
  { value: "super_admin", label: "Super Admin", description: "Full system access" },
  { value: "super_school_admin", label: "Super School Admin", description: "School owner / management board with full oversight" },
  { value: "school_admin", label: "School Admin / Principal", description: "Manage school users, settings, and performance" },
  { value: "coordinator", label: "Coordinator", description: "Coordinate exams and teachers" },
  { value: "teacher", label: "Teacher", description: "Create exams and evaluate students" },
  { value: "student", label: "Student", description: "Take exams and view results" },
];

export function ChangeRoleDialog({ open, onOpenChange, userId, userName }: ChangeRoleDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedRoles, setSelectedRoles] = useState<AppRole[]>([]);

  // Get the current user's role to enforce governance rules
  const { data: myRoles } = useQuery({
    queryKey: ["my-roles-for-governance"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      return (data || []).map(r => r.role);
    },
    enabled: open,
  });

  const iAmSuperAdmin = myRoles?.includes("super_admin") ?? false;
  const iAmSuperSchoolAdmin = myRoles?.includes("super_school_admin") ?? false;

  const { data: currentRoles } = useQuery({
    queryKey: ["user-roles", userId],
    queryFn: async () => {
      if (!userId) return [];
      const { data } = await supabase
        .from("user_roles")
        .select("role, institution_id")
        .eq("user_id", userId);
      return data || [];
    },
    enabled: !!userId && open,
  });

  const targetHasSuperSchoolAdmin = currentRoles?.some(r => r.role === "super_school_admin") ?? false;
  // school_admin cannot modify a super_school_admin's roles
  const isProtected = targetHasSuperSchoolAdmin && !iAmSuperAdmin && !iAmSuperSchoolAdmin;

  useEffect(() => {
    if (currentRoles) {
      setSelectedRoles(currentRoles.map(r => r.role as AppRole));
    }
  }, [currentRoles]);

  const updateRoles = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error("No user selected");
      if (selectedRoles.length === 0) throw new Error("User must have at least one role");

      // Get user's institution
      const { data: profile } = await supabase
        .from("profiles")
        .select("institution_id")
        .eq("id", userId)
        .single();

      const institutionId = profile?.institution_id;

      // Delete current roles
      await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", userId);

      // Insert new roles
      const rolesToInsert = selectedRoles.map(role => ({
        user_id: userId,
        role,
        institution_id: institutionId,
      }));

      const { error } = await supabase
        .from("user_roles")
        .insert(rolesToInsert);

      if (error) throw error;

      void logActivityEvent({
        action: "user_roles_changed",
        entityType: "User",
        entityId: userId,
        entityName: userName,
        oldValues: { roles: (currentRoles ?? []).map((r) => r.role).join(", ") },
        newValues: { roles: selectedRoles.join(", ") },
        metadata: { institution_id: institutionId ?? null },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      queryClient.invalidateQueries({ queryKey: ["user-roles", userId] });
      toast({ title: "Roles updated successfully" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update roles", description: error.message, variant: "destructive" });
    },
  });

  const toggleRole = (role: AppRole) => {
    setSelectedRoles(prev => 
      prev.includes(role) 
        ? prev.filter(r => r !== role)
        : [...prev, role]
    );
  };

  const hasChanged = currentRoles && (
    selectedRoles.length !== currentRoles.length ||
    !selectedRoles.every(r => currentRoles.some(cr => cr.role === r))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Change User Role</DialogTitle>
          <DialogDescription>
            Update roles for {userName}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 space-y-4">
          {isProtected && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                You cannot modify a Super School Admin's roles. Only Super Admins or other Super School Admins can do this.
              </AlertDescription>
            </Alert>
          )}

          {!isProtected && (
            <Alert variant="destructive" className="bg-amber-50 border-amber-200">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800">
                Changing roles will immediately affect user permissions
              </AlertDescription>
            </Alert>
          )}

          <div className="space-y-3">
            {ROLES.map((role) => (
              <div
                key={role.value}
                className={`flex items-start space-x-3 p-3 rounded-lg border hover:bg-muted/50 ${isProtected ? "opacity-50 pointer-events-none" : "cursor-pointer"}`}
                onClick={() => !isProtected && toggleRole(role.value)}
              >
                <Checkbox
                  checked={selectedRoles.includes(role.value)}
                  onCheckedChange={() => !isProtected && toggleRole(role.value)}
                  disabled={isProtected}
                />
                <div className="space-y-1">
                  <Label className="font-medium cursor-pointer">{role.label}</Label>
                  <p className="text-xs text-muted-foreground">{role.description}</p>
                </div>
              </div>
            ))}
          </div>

          {selectedRoles.length === 0 && (
            <p className="text-sm text-destructive">User must have at least one role</p>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={() => updateRoles.mutate()} 
            disabled={isProtected || updateRoles.isPending || selectedRoles.length === 0 || !hasChanged}
          >
            {updateRoles.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Update Roles
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
