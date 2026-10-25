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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Layers, AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import type { Database } from "@/integrations/supabase/types";
import { invalidateSchoolData, invalidateUserAssignments } from "@/lib/queryKeys";
import { setStaffClassAssignments } from "@/lib/staffAssignments";
import { sortClassRows } from "@/lib/classSort";
import { formatClassName } from "@/lib/utils";

type AppRole = Database["public"]["Enums"]["app_role"];

interface AssignClassesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; full_name: string } | null;
  institutionId: string;
  role: AppRole;
}

export function AssignClassesDialog({
  open,
  onOpenChange,
  user,
  institutionId,
  role,
}: AssignClassesDialogProps) {
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [removalConfirm, setRemovalConfirm] = useState<{ count: number; classes: string[] } | null>(null);
  const queryClient = useQueryClient();

  // For coordinators, first check if they have wing assignments
  const { data: userWingData, isLoading: loadingWings } = useQuery({
    queryKey: ["user-wing-classes-for-assign", user?.id],
    queryFn: async () => {
      if (!user || role !== "coordinator") return null;
      
      const { data: wingAssignments, error: wingError } = await supabase
        .from("wing_assignments")
        .select("wing_id")
        .eq("user_id", user.id);

      if (wingError) throw wingError;
      
      const wingIds = wingAssignments?.map(a => a.wing_id) || [];
      
      if (wingIds.length === 0) {
        return { wingIds: [], classIds: [] };
      }

      // Get classes from wing_class_mappings
      const { data: classMappings, error: classError } = await supabase
        .from("wing_class_mappings")
        .select("class_id")
        .in("wing_id", wingIds);

      if (classError) throw classError;

      return {
        wingIds,
        classIds: [...new Set(classMappings?.map(c => c.class_id) || [])],
      };
    },
    enabled: !!user?.id && open && role === "coordinator",
  });

  const { data: classes, isLoading: loadingClasses } = useQuery({
    queryKey: ["institution-classes-for-assign", institutionId, userWingData?.classIds],
    queryFn: async () => {
      // For coordinators with wing assignments, only show classes from their wings
      if (role === "coordinator" && userWingData?.wingIds.length) {
        if (userWingData.classIds.length === 0) {
          return []; // No classes in their wings
        }
        const { data, error } = await supabase
          .from("classes")
          .select("id, name, section, academic_year")
          .in("id", userWingData.classIds)
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
      }

      // For other roles or coordinators without wing assignments, show all classes
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId && open && (role !== "coordinator" || userWingData !== undefined),
  });

  const { data: existingAssignments, isLoading: loadingAssignments } = useQuery({
    queryKey: ["user-class-assignments", user?.id, role],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id")
        .eq("user_id", user.id)
        .eq("role", role);

      if (error) throw error;
      return data.map((a) => a.class_id);
    },
    enabled: !!user?.id && open,
  });

  useEffect(() => {
    if (existingAssignments) {
      setSelectedClasses(existingAssignments);
    }
  }, [existingAssignments]);

  const handleToggleClass = (classId: string) => {
    setSelectedClasses((prev) =>
      prev.includes(classId)
        ? prev.filter((id) => id !== classId)
        : [...prev, classId]
    );
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!user) {
        throw new Error("No user selected");
      }
      if (role !== "teacher" && role !== "coordinator") {
        throw new Error(`Unsupported role for class assignment: ${role}`);
      }

      // Single transaction server-side (set_staff_class_assignments, kind
      // 'bare'): manages ONLY subject-less class links, so this dialog can no
      // longer wipe a teacher's subject assignments; diffs instead of
      // delete-all-then-reinsert and audit-logs the delta.
      return setStaffClassAssignments({
        userId: user.id,
        pairs: selectedClasses.map((classId) => ({ class_id: classId })),
        role,
        kind: "bare",
      });
    },
    onSuccess: (result) => {
      toast.success(
        result.removed_count > 0
          ? `Class assignments updated: ${result.added_count} added, ${result.removed_count} removed`
          : "Class assignments updated",
      );
      // Use centralized invalidation for consistent refresh
      invalidateSchoolData(queryClient, institutionId);
      invalidateUserAssignments(queryClient, user?.id);
      onOpenChange(false);
    },
    onError: (error) => {
      toastError(error, { fallback: "Couldn't update the class assignments.", context: "assignClasses" });
    },
  });

  // Destructive-save guard: unticking classes removes those assignments on
  // save (an empty selection removes them all). Confirm before proceeding.
  const handleSaveClick = () => {
    const removedIds = (existingAssignments ?? []).filter((id) => !selectedClasses.includes(id));
    if (removedIds.length === 0) {
      assignMutation.mutate();
      return;
    }
    const classNames = removedIds.map((id) => {
      const cls = classes?.find((c) => c.id === id);
      return cls ? formatClassName(cls.name, cls.section) : "another class";
    });
    setRemovalConfirm({ count: removedIds.length, classes: classNames });
  };

  const isLoading = loadingClasses || loadingAssignments || (role === "coordinator" && loadingWings);
  
  // Check if coordinator has no wing assignments
  const hasNoWings = role === "coordinator" && userWingData?.wingIds.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Classes</DialogTitle>
          <DialogDescription>
            Select classes to assign {user?.full_name} to.
          </DialogDescription>
        </DialogHeader>

        {/* Warning for coordinators without wing assignments */}
        {hasNoWings && (
          <Alert variant="destructive" className="bg-amber-50 border-amber-200 text-amber-800">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              This coordinator has no wing assignments. Please assign them to a wing first to determine which classes they can manage.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : classes && classes.length > 0 ? (
          <ScrollArea className="max-h-[300px] py-4">
            <div className="space-y-2">
              {classes.map((cls) => (
                <div
                  key={cls.id}
                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleToggleClass(cls.id)}
                >
                  <Checkbox
                    checked={selectedClasses.includes(cls.id)}
                    onCheckedChange={() => handleToggleClass(cls.id)}
                  />
                  <div className="flex-1">
                    <span className="font-medium cursor-pointer">
                      {formatClassName(cls.name, cls.section)}
                    </span>
                    <p className="text-sm text-muted-foreground">{cls.academic_year}</p>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="py-8 text-center">
            <Layers className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-muted-foreground">No classes found in this institution.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSaveClick} disabled={assignMutation.isPending || isLoading}>
            {assignMutation.isPending
              ? "Saving..."
              : `Assign ${selectedClasses.length} Class${selectedClasses.length !== 1 ? "es" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Destructive-save confirmation: saving would remove existing assignments */}
      <AlertDialog open={!!removalConfirm} onOpenChange={(o) => !o && setRemovalConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removalConfirm?.count} class assignment{removalConfirm?.count !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Saving will remove {user?.full_name} from: {removalConfirm?.classes.join(", ")}. They
              will lose access to those classes until reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={assignMutation.isPending}
              onClick={() => {
                setRemovalConfirm(null);
                assignMutation.mutate();
              }}
            >
              Remove and save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
