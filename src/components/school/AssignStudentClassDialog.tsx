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
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateSchoolData } from "@/lib/queryKeys";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";

interface AssignStudentClassDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  student: { id: string; full_name: string; currentClassId?: string } | null;
  institutionId: string;
  coordinatorClassIds?: string[];
}

export function AssignStudentClassDialog({
  open,
  onOpenChange,
  student,
  institutionId,
  coordinatorClassIds,
}: AssignStudentClassDialogProps) {
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const queryClient = useQueryClient();

  const { data: classes, isLoading } = useQuery({
    queryKey: ["institution-classes", institutionId, coordinatorClassIds],
    queryFn: async () => {
      // Presence of the prop is the scoping signal, not its length. `length > 0`
      // failed OPEN: a coordinator whose wing resolves to no classes fell
      // through to the whole institution's list (2026-09-18). Admins pass
      // undefined/null and are still unscoped.
      if (coordinatorClassIds) {
        if (coordinatorClassIds.length === 0) return [];
        const { data, error } = await supabase
          .from("classes")
          .select("id, name, section, academic_year")
          .in("id", coordinatorClassIds)
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
      }

      // Admin - all institution classes
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!institutionId && open,
  });

  useEffect(() => {
    if (student?.currentClassId) {
      setSelectedClassId(student.currentClassId);
    } else {
      setSelectedClassId("");
    }
  }, [student]);

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!student) {
        throw new Error("No student selected");
      }
      
      if (!selectedClassId) {
        throw new Error("Please select a class");
      }

      console.log("Assigning class:", { 
        studentId: student.id, 
        studentName: student.full_name,
        classId: selectedClassId,
        institutionId,
        role: "student" 
      });

      // Insert FIRST, then prune the old rows. The reverse order (delete then
      // insert) leaves the student in no class at all when the insert fails —
      // the same destructive-on-failure shape that wiped two teachers on
      // 2026-08-07. This way a failed insert changes nothing, and a failed
      // prune leaves a visible, fixable duplicate instead of a silent loss.
      const { data: insertedData, error: insertError } = await supabase
        .from("class_assignments")
        .insert({
          user_id: student.id,
          class_id: selectedClassId,
          role: "student",
        })
        .select();

      if (insertError) {
        console.error("Insert error:", insertError);
        throw new Error(`Failed to create class assignment: ${insertError.message}`);
      }

      if (!insertedData || insertedData.length === 0) {
        console.error("Insert returned no data - RLS may have blocked the insert");
        throw new Error("Class assignment was not created - check permissions");
      }

      // Prune any other student rows now that the new one is safely in place.
      const { error: deleteError } = await supabase
        .from("class_assignments")
        .delete()
        .eq("user_id", student.id)
        .eq("role", "student")
        .neq("class_id", selectedClassId);

      if (deleteError) {
        console.error("Delete error:", deleteError);
        throw new Error(`Failed to remove the previous assignment: ${deleteError.message}`);
      }

      console.log("Successfully created assignment:", insertedData);
      return insertedData;
    },
    onSuccess: async (data) => {
      console.log("Mutation success, data:", data);
      toast.success("Class assignment updated successfully");
      // Use centralized invalidation for consistent refresh
      await invalidateSchoolData(queryClient, institutionId);
      onOpenChange(false);
    },
    onError: (error) => {
      console.error("Mutation error:", error);
      toast.error(error instanceof Error ? error.message : "Failed to update class assignment");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign to Class</DialogTitle>
          <DialogDescription>
            Select a class to assign {student?.full_name} to.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="class">Class</Label>
              <SearchableSelect
                value={selectedClassId}
                onValueChange={setSelectedClassId}
                placeholder="Select a class"
                searchPlaceholder="Search classes..."
                options={classes?.map((cls) => ({
                  value: cls.id,
                  label: `${formatClassName(cls.name, cls.section)} (${cls.academic_year})`,
                })) || []}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => assignMutation.mutate()}
            disabled={!selectedClassId || assignMutation.isPending}
          >
            {assignMutation.isPending ? "Saving..." : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
