import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { GraduationCap } from "lucide-react";
import { useInstitutionTeachers, useClassTeachers, useAssignTeachers, ClassData } from "@/hooks/useClasses";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";

interface AssignTeachersDialogProps {
  classData: ClassData | null;
  institutionId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When provided, only show teachers assigned to these classes (for coordinators) */
  coordinatorClassIds?: string[];
}

export default function AssignTeachersDialog({ 
  classData, 
  institutionId,
  open, 
  onOpenChange,
  coordinatorClassIds,
}: AssignTeachersDialogProps) {
  const [selectedTeachers, setSelectedTeachers] = useState<string[]>([]);
  const [removalConfirm, setRemovalConfirm] = useState<string[] | null>(null);

  const { data: allTeachers, isLoading: loadingTeachers } = useInstitutionTeachers(institutionId);
  const { data: assignedTeachers, isLoading: loadingAssigned } = useClassTeachers(classData?.id || null);
  const assignTeachers = useAssignTeachers();

  // For coordinators, filter teachers to only those assigned to coordinator's wing classes
  const { data: wingTeacherIds } = useQuery({
    queryKey: ["coordinator-wing-teachers", coordinatorClassIds],
    queryFn: async () => {
      if (!coordinatorClassIds || coordinatorClassIds.length === 0) return null;
      const { data, error } = await supabase
        .from("class_assignments")
        .select("user_id")
        .in("class_id", coordinatorClassIds)
        .eq("role", "teacher");
      if (error) throw error;
      return [...new Set(data?.map(d => d.user_id) || [])];
    },
    enabled: !!coordinatorClassIds && coordinatorClassIds.length > 0,
  });

  const teachers = useMemo(() => {
    if (!allTeachers) return [];
    // A coordinator is confined to their wing's teachers UNCONDITIONALLY. The
    // old guard failed open twice over: an empty scope, and a wing-teacher
    // lookup that had not resolved, both fell through to every teacher in the
    // school (2026-09-18). Admins pass undefined and stay unscoped.
    if (coordinatorClassIds) {
      if (coordinatorClassIds.length === 0 || !wingTeacherIds) return [];
      return allTeachers.filter(t => wingTeacherIds.includes(t.id));
    }
    return allTeachers;
  }, [allTeachers, coordinatorClassIds, wingTeacherIds]);

  useEffect(() => {
    if (assignedTeachers) {
      setSelectedTeachers(assignedTeachers);
    }
  }, [assignedTeachers]);

  const handleToggleTeacher = (teacherId: string) => {
    setSelectedTeachers(prev => 
      prev.includes(teacherId)
        ? prev.filter(id => id !== teacherId)
        : [...prev, teacherId]
    );
  };

  const submit = async () => {
    if (!classData) return;
    try {
      await assignTeachers.mutateAsync({
        classId: classData.id,
        teacherIds: selectedTeachers,
      });
      onOpenChange(false);
    } catch {
      // Error is already surfaced by the mutation's onError callback
    }
  };

  // Destructive-save guard: unticking a teacher removes every assignment they
  // hold on this class (including their subject links). Never do that silently.
  const handleSubmit = () => {
    const removed = (assignedTeachers ?? []).filter((id) => !selectedTeachers.includes(id));
    if (removed.length === 0) {
      void submit();
      return;
    }
    setRemovalConfirm(
      removed.map((id) => allTeachers?.find((t) => t.id === id)?.full_name ?? "a teacher"),
    );
  };

  const isLoading = loadingTeachers || loadingAssigned;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Assign Teachers</DialogTitle>
          <DialogDescription>
            Select teachers to assign to {formatClassName(classData?.name || "", classData?.section)}.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : teachers && teachers.length > 0 ? (
          <div className="py-4">
            <div className="space-y-2">
              {teachers.map((teacher) => (
                <div
                  key={teacher.id}
                  className="flex items-center space-x-3 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer"
                  onClick={() => handleToggleTeacher(teacher.id)}
                >
                  <Checkbox
                    checked={selectedTeachers.includes(teacher.id)}
                    onCheckedChange={() => handleToggleTeacher(teacher.id)}
                  />
                  <div className="flex-1">
                    <span className="font-medium cursor-pointer">
                      {teacher.full_name}
                    </span>
                    <p className="text-sm text-muted-foreground">{teacher.email}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="py-8 text-center">
            <GraduationCap className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
            <p className="text-muted-foreground">No teachers found in this institution.</p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={assignTeachers.isPending || isLoading}
          >
            {assignTeachers.isPending ? "Saving..." : `Assign ${selectedTeachers.length} Teacher${selectedTeachers.length !== 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Destructive-save confirmation: saving would unassign teachers */}
      <AlertDialog open={!!removalConfirm} onOpenChange={(o) => !o && setRemovalConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Unassign {removalConfirm?.length} teacher{removalConfirm?.length !== 1 ? "s" : ""} from this class?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Saving will remove {removalConfirm?.join(", ")} from{" "}
              {formatClassName(classData?.name || "", classData?.section)}, including every subject
              they teach in it. They will lose access to this class until reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={assignTeachers.isPending}
              onClick={() => {
                setRemovalConfirm(null);
                void submit();
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
