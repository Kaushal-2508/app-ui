import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Building2, UserCog, AlertTriangle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useWings } from "@/hooks/useWings";
import { invalidateSchoolData, invalidateUserAssignments } from "@/lib/queryKeys";

interface PromoteToCoordinatorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; full_name: string } | null;
  institutionId: string;
}

export function PromoteToCoordinatorDialog({
  open,
  onOpenChange,
  user,
  institutionId,
}: PromoteToCoordinatorDialogProps) {
  const [selectedWings, setSelectedWings] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: wings, isLoading: loadingWings } = useWings(institutionId);

  // Reset selections when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedWings([]);
    }
  }, [open]);

  const handleToggleWing = (wingId: string) => {
    setSelectedWings((prev) =>
      prev.includes(wingId)
        ? prev.filter((id) => id !== wingId)
        : [...prev, wingId]
    );
  };

  const promoteMutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        throw new Error("No user selected");
      }

      if (selectedWings.length === 0) {
        throw new Error("Please select at least one wing");
      }

      const { data: currentUser } = await supabase.auth.getUser();

      // Check if user already has coordinator role
      const { data: existingRole } = await supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user.id)
        .eq("role", "coordinator")
        .eq("institution_id", institutionId)
        .maybeSingle();

      // Only insert if coordinator role doesn't exist
      if (!existingRole) {
        const { error: roleError } = await supabase.from("user_roles").insert({
          user_id: user.id,
          role: "coordinator",
          institution_id: institutionId,
        });

        if (roleError) {
          console.error("Role insert error:", roleError);
          throw new Error("Failed to add coordinator role");
        }
      }

      // Add wing assignments
      const wingAssignments = selectedWings.map((wingId) => ({
        user_id: user.id,
        wing_id: wingId,
        assigned_by: currentUser.user?.id,
      }));

      const { error: wingError } = await supabase
        .from("wing_assignments")
        .upsert(wingAssignments, { onConflict: "user_id,wing_id" });

      if (wingError) {
        console.error("Wing assignment error:", wingError);
        throw new Error("Failed to assign wings");
      }
    },
    onSuccess: () => {
      toast.success(`${user?.full_name} is now a Coordinator`);
      
      // Invalidate user role cache (critical for promoted user's session update)
      queryClient.invalidateQueries({ queryKey: ["user-role-info"] });
      
      // Use centralized invalidation for consistent refresh
      invalidateSchoolData(queryClient, institutionId);
      invalidateUserAssignments(queryClient, user?.id);
      
      // Specifically invalidate with institution ID for correct cache targeting
      queryClient.invalidateQueries({ queryKey: ["school-coordinators", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["school-teachers", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["wings", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["wing-assignments"] });
      
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to promote to coordinator");
      console.error(error);
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-5 w-5 text-purple-500" />
            Make Coordinator
          </DialogTitle>
          <DialogDescription>
            Promote <strong>{user?.full_name}</strong> to Coordinator role and assign to wings.
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-purple-200 bg-purple-50 dark:bg-purple-950/20">
          <UserCog className="h-4 w-4 text-purple-600" />
          <AlertDescription className="text-purple-800 dark:text-purple-200">
            This teacher will also receive the <strong>Coordinator</strong> role and can manage 
            students and teachers within their assigned wings.
          </AlertDescription>
        </Alert>

        {loadingWings ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : wings && wings.length > 0 ? (
          <>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="h-4 w-4" />
              <span>Select wing(s) to assign</span>
            </div>
            <ScrollArea className="max-h-[300px] py-2 flex-1">
              <div className="space-y-2 pr-4">
                {wings.map((wing) => (
                  <div
                    key={wing.id}
                    className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedWings.includes(wing.id)
                        ? "bg-primary/5 border-primary/30"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => handleToggleWing(wing.id)}
                  >
                    <Checkbox
                      checked={selectedWings.includes(wing.id)}
                      onCheckedChange={() => handleToggleWing(wing.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{wing.name}</span>
                        {!wing.is_active && (
                          <Badge variant="secondary" className="text-xs">Inactive</Badge>
                        )}
                      </div>
                      {wing.description && (
                        <p className="text-sm text-muted-foreground truncate">
                          {wing.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {wing.assigned_users} users
                    </Badge>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="py-8 text-center">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-muted-foreground">No wings found in this institution.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create wings from the Wings page first before assigning coordinators.
            </p>
          </div>
        )}

        {selectedWings.length === 0 && wings && wings.length > 0 && (
          <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-amber-800 dark:text-amber-200">
              Please select at least one wing for this coordinator
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={() => promoteMutation.mutate()} 
            disabled={promoteMutation.isPending || !wings?.length || selectedWings.length === 0}
            className="bg-purple-600 hover:bg-purple-700"
          >
            {promoteMutation.isPending
              ? "Promoting..."
              : `Make Coordinator (${selectedWings.length} wing${selectedWings.length !== 1 ? "s" : ""})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
