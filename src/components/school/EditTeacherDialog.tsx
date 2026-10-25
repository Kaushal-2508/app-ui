import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { Loader2 } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teacher: { id: string; full_name: string; email?: string; is_active?: boolean } | null;
  /**
   * Whether the caller may change the auth identity (email / password),
   * which goes through the admin-operations edge fn. Defaults to true
   * (admins/coordinators). A staff-manager-override holder passes false —
   * they edit name + active status only (profiles RLS), and the auth
   * fields are hidden so nothing errors.
   */
  allowAuthEdit?: boolean;
}

export function EditTeacherDialog({ open, onOpenChange, teacher, allowAuthEdit = true }: Props) {
  const [fullName, setFullName] = useState(teacher?.full_name || "");
  const [email, setEmail] = useState(teacher?.email || "");
  const [newPassword, setNewPassword] = useState("");
  const [isActive, setIsActive] = useState(teacher?.is_active ?? true);
  const queryClient = useQueryClient();

  // Reset fields when teacher changes
  const currentTeacherId = teacher?.id;
  const [lastTeacherId, setLastTeacherId] = useState<string | null>(null);
  if (currentTeacherId && currentTeacherId !== lastTeacherId) {
    setLastTeacherId(currentTeacherId);
    setFullName(teacher?.full_name || "");
    setEmail(teacher?.email || "");
    setNewPassword("");
    setIsActive(teacher?.is_active ?? true);
  }

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!teacher) throw new Error("No teacher selected");

      // Update profile name and active status
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: fullName, is_active: isActive })
        .eq("id", teacher.id);
      if (profileError) throw profileError;

      // Update email/password via admin-operations edge function if changed.
      // Only when the caller is permitted to mutate the auth identity —
      // staff-manager-override holders never reach this branch (fields hidden).
      const needsAuthUpdate = allowAuthEdit && ((email && email !== teacher.email) || newPassword);
      if (needsAuthUpdate) {
        const updatePayload: Record<string, string> = {};
        if (email && email !== teacher.email) updatePayload.email = email;
        if (newPassword) updatePayload.password = newPassword;

        await invokeAdminOperation({
          action: "update_user",
          data: { userId: teacher.id, updates: updatePayload },
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      toast.success("Teacher details updated successfully");
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't update teacher details.", context: "updateTeacher" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Teacher Details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Full Name</Label>
            <Input id="edit-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          {allowAuthEdit && (
            <>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-password">New Password (leave blank to keep current)</Label>
                <PasswordInput id="edit-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="••••••••" />
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-active">Active Status</Label>
            <Switch id="edit-active" checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || !fullName.trim()}>
            {updateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving...</> : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
