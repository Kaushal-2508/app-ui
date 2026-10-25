import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getDisplayName } from "@/lib/displayName";
import { Skeleton } from "@/components/ui/skeleton";
import { Crown, Shield, ArrowUp, ArrowDown, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface AssignSchoolOwnerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
  institutionName: string;
}

interface InstitutionUser {
  id: string;
  full_name: string;
  email: string;
  role: string;
  roleId: string;
}

export function AssignSchoolOwnerDialog({
  open,
  onOpenChange,
  institutionId,
  institutionName,
}: AssignSchoolOwnerDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [promotingUserId, setPromotingUserId] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["institution-admin-users", institutionId],
    queryFn: async () => {
      if (!institutionId) return [];

      const { data: roles, error } = await supabase
        .from("user_roles")
        .select(`
          id, role, user_id,
          profiles!user_roles_user_id_fkey (id, full_name, email)
        `)
        .eq("institution_id", institutionId)
        .in("role", ["school_admin", "super_school_admin"] as any[]);

      if (error) throw error;

      return (roles || []).map((r: any) => ({
        id: r.user_id,
        full_name: getDisplayName(r.profiles),
        email: r.profiles?.email || "",
        role: r.role as string,
        roleId: r.id,
      })) as InstitutionUser[];
    },
    enabled: open && !!institutionId,
  });

  const toggleRoleMutation = useMutation({
    mutationFn: async ({ roleId, newRole }: { roleId: string; newRole: string }) => {
      const { error } = await supabase
        .from("user_roles")
        .update({ role: newRole as any })
        .eq("id", roleId);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      const action = variables.newRole === "super_school_admin" ? "promoted to Owner" : "demoted to Admin";
      toast({ title: "Role Updated", description: `User ${action} successfully.` });
      queryClient.invalidateQueries({ queryKey: ["institution-admin-users", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      setPromotingUserId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update role", description: error.message, variant: "destructive" });
      setPromotingUserId(null);
    },
  });

  const handleToggle = (user: InstitutionUser) => {
    const newRole = user.role === "super_school_admin" ? "school_admin" : "super_school_admin";
    setPromotingUserId(user.id);
    toggleRoleMutation.mutate({ roleId: user.roleId, newRole });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-amber-500" />
            Assign School Owner
          </DialogTitle>
          <DialogDescription>
            Promote or demote admins for <strong>{institutionName}</strong>. Owners (Super School Admins) have full oversight access.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))
          ) : users && users.length > 0 ? (
            users.map((user) => {
              const isOwner = user.role === "super_school_admin";
              const isProcessing = promotingUserId === user.id;
              return (
                <div
                  key={user.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm truncate">{user.full_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-2 ml-2">
                    <Badge
                      variant={isOwner ? "default" : "secondary"}
                      className="text-xs whitespace-nowrap"
                    >
                      {isOwner ? (
                        <><Crown className="h-3 w-3 mr-1" /> Owner</>
                      ) : (
                        <><Shield className="h-3 w-3 mr-1" /> Admin</>
                      )}
                    </Badge>
                    <Button
                      size="sm"
                      variant={isOwner ? "outline" : "default"}
                      onClick={() => handleToggle(user)}
                      disabled={isProcessing}
                      className="text-xs"
                    >
                      {isProcessing ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isOwner ? (
                        <><ArrowDown className="h-3 w-3 mr-1" /> Demote</>
                      ) : (
                        <><ArrowUp className="h-3 w-3 mr-1" /> Make Owner</>
                      )}
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground text-center py-6">
              No admins found for this institution.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
