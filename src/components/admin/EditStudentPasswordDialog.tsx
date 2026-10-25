import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { 
  Loader2, 
  Key, 
  RefreshCw, 
  Copy, 
  Check, 
  Eye, 
  EyeOff,
  AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { useCanEditStudentPassword } from "@/hooks/useCanEditStudentPassword";

interface EditStudentPasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: {
    id: string;
    full_name: string;
    email: string;
  } | null;
}

export function EditStudentPasswordDialog({
  open,
  onOpenChange,
  student,
}: EditStudentPasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  
  const { data: canEditResult, isLoading: checkingPermission } = useCanEditStudentPassword(student?.id || null);

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    let newPassword = "";
    for (let i = 0; i < 12; i++) {
      newPassword += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPassword(newPassword);
    setShowPassword(true);
  };

  const copyToClipboard = async () => {
    if (!password) return;
    await navigator.clipboard.writeText(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Password copied to clipboard");
  };

  const resetMutation = useMutation({
    mutationFn: async () => {
      if (!student || !password) throw new Error("Missing student or password");

      return invokeAdminOperation({
        action: "reset_user_password",
        data: {
          userId: student.id,
          newPassword: password,
        },
      });
    },
    onSuccess: () => {
      toast.success("Password updated successfully", {
        description: "The student can now log in with the new password.",
      });
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      handleClose();
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Couldn't update password.", context: "resetStudentPassword" }),
  });

  const handleClose = () => {
    setPassword("");
    setShowPassword(false);
    setCopied(false);
    onOpenChange(false);
  };

  const handleSubmit = () => {
    if (password.length < 8) {
      toast.error("Password too short", {
        description: "Password must be at least 8 characters long.",
      });
      return;
    }
    resetMutation.mutate();
  };

  if (!student) return null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            Reset Student Password
          </DialogTitle>
          <DialogDescription>
            Set a new password for <strong>{student.full_name}</strong>
          </DialogDescription>
        </DialogHeader>

        {checkingPermission || !canEditResult ? (
          // `!canEditResult` (result still undefined) is treated as "checking",
          // not "denied" — otherwise an unresolved permission query renders as a
          // false "no permission" message.
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !canEditResult.canEdit ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              {canEditResult.reason || "You don't have permission to change this student's password."}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4 py-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{student.full_name}</p>
                  <p className="text-sm text-muted-foreground">{student.email}</p>
                </div>
                <Badge variant="secondary">Student</Badge>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">New Password</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter new password"
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full px-3"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <Eye className="h-4 w-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={generatePassword}
                  title="Generate random password"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={copyToClipboard}
                  disabled={!password}
                  title="Copy to clipboard"
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Password must be at least 8 characters. Use the generate button for a secure random password.
              </p>
            </div>

            <Alert>
              <AlertDescription className="text-sm">
                <strong>Important:</strong> Make sure to securely share the new password with the student. 
                They will need it to log in to their account.
              </AlertDescription>
            </Alert>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !password || 
              password.length < 8 || 
              resetMutation.isPending ||
              !canEditResult?.canEdit
            }
          >
            {resetMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Update Password
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
