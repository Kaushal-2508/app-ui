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
import { Building2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useWings } from "@/hooks/useWings";
import { invalidateSchoolData, invalidateUserAssignments } from "@/lib/queryKeys";

interface AssignWingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; full_name: string } | null;
  institutionId: string;
}

export function AssignWingDialog({
  open,
  onOpenChange,
  user,
  institutionId,
}: AssignWingDialogProps) {
  const [selectedWings, setSelectedWings] = useState<string[]>([]);
  const queryClient = useQueryClient();

  const { data: wings, isLoading: loadingWings } = useWings(institutionId);

  const { data: existingAssignments, isLoading: loadingAssignments } = useQuery({
    queryKey: ["user-wing-assignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("wing_assignments")
        .select("wing_id")
        .eq("user_id", user.id);

      if (error) throw error;
      return data.map((a) => a.wing_id);
    },
    enabled: !!user?.id && open,
  });

  useEffect(() => {
    if (existingAssignments) {
      setSelectedWings(existingAssignments);
    }
  }, [existingAssignments]);

  const handleToggleWing = (wingId: string) => {
    setSelectedWings((prev) =>
      prev.includes(wingId)
        ? prev.filter((id) => id !== wingId)
        : [...prev, wingId]
    );
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        throw new Error("No user selected");
      }

      const { data: currentUser } = await supabase.auth.getUser();

      // Remove all existing wing assignments for this user with error checking
      const { error: deleteError } = await supabase
        .from("wing_assignments")
        .delete()
        .eq("user_id", user.id);

      if (deleteError) {
        console.error("Delete error:", deleteError);
        throw new Error("Failed to remove existing wing assignments");
      }

      // Add new assignments
      if (selectedWings.length > 0) {
        const assignments = selectedWings.map((wingId) => ({
          user_id: user.id,
          wing_id: wingId,
          assigned_by: currentUser.user?.id,
        }));

        const { error: insertError } = await supabase.from("wing_assignments").insert(assignments);
        if (insertError) {
          console.error("Insert error:", insertError);
          throw new Error("Failed to create wing assignments");
        }
      }
    },
    onSuccess: () => {
      toast.success("Wing assignments updated");
      // Use centralized invalidation for consistent refresh
      invalidateSchoolData(queryClient, institutionId);
      invalidateUserAssignments(queryClient, user?.id);
      queryClient.invalidateQueries({ queryKey: ["wings"] });
      queryClient.invalidateQueries({ queryKey: ["wing-assignments"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update wing assignments");
      console.error(error);
    },
  });

  const isLoading = loadingWings || loadingAssignments;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md overflow-hidden flex flex-col max-h-[85vh]">
        <DialogHeader>
          <DialogTitle>Assign to Wings</DialogTitle>
          <DialogDescription>
            Select wings to assign {user?.full_name} to. Coordinators can only see classes within their assigned wings.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : wings && wings.length > 0 ? (
          <ScrollArea className="max-h-[400px] py-4 flex-1">
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
        ) : (
          <div className="py-8 text-center">
            <Building2 className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-muted-foreground">No wings found in this institution.</p>
            <p className="text-sm text-muted-foreground mt-1">
              Create wings from the Wings page first.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={() => assignMutation.mutate()} 
            disabled={assignMutation.isPending || !wings?.length}
          >
            {assignMutation.isPending
              ? "Saving..."
              : `Assign ${selectedWings.length} Wing${selectedWings.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
