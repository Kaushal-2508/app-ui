import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, Plus, Minus, Check } from "lucide-react";
import {
  useSubjectsByGrade,
  useAvailableSubjectsForGrade,
  useAssignSubjectToGrade,
  useRemoveSubjectFromGrade,
  type Subject,
} from "@/hooks/useSyllabusHierarchy";

interface AssignSubjectsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gradeId: string;
  gradeName: string;
}

export function AssignSubjectsDialog({
  open,
  onOpenChange,
  gradeId,
  gradeName,
}: AssignSubjectsDialogProps) {
  const { data: assignedSubjects = [], isLoading: loadingAssigned } = useSubjectsByGrade(gradeId);
  const { data: availableSubjects = [], isLoading: loadingAvailable } = useAvailableSubjectsForGrade(gradeId);
  const assignSubject = useAssignSubjectToGrade();
  const removeSubject = useRemoveSubjectFromGrade();

  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [selectedToRemove, setSelectedToRemove] = useState<Set<string>>(new Set());

  // Reset selections when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedToAdd(new Set());
      setSelectedToRemove(new Set());
    }
  }, [open]);

  const isLoading = loadingAssigned || loadingAvailable;
  const isPending = assignSubject.isPending || removeSubject.isPending;

  const handleToggleAdd = (subjectId: string) => {
    setSelectedToAdd((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        next.add(subjectId);
      }
      return next;
    });
  };

  const handleToggleRemove = (subjectId: string) => {
    setSelectedToRemove((prev) => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        next.add(subjectId);
      }
      return next;
    });
  };

  const handleAssignSelected = async () => {
    for (const subjectId of selectedToAdd) {
      await assignSubject.mutateAsync({ gradeId, subjectId });
    }
    setSelectedToAdd(new Set());
  };

  const handleRemoveSelected = async () => {
    for (const subjectId of selectedToRemove) {
      await removeSubject.mutateAsync({ gradeId, subjectId });
    }
    setSelectedToRemove(new Set());
  };

  const getCategoryColor = (category: string | null) => {
    switch (category) {
      case "Language":
        return "bg-blue-500/10 text-blue-500";
      case "Core":
        return "bg-green-500/10 text-green-500";
      case "Elective":
        return "bg-purple-500/10 text-purple-500";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const SubjectItem = ({
    subject,
    isChecked,
    onToggle,
    action,
  }: {
    subject: Subject;
    isChecked: boolean;
    onToggle: () => void;
    action: "add" | "remove";
  }) => (
    <div
      className="flex items-center gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer"
      onClick={onToggle}
    >
      <Checkbox checked={isChecked} onCheckedChange={onToggle} />
      <BookOpen className="h-4 w-4 text-muted-foreground" />
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate">{subject.name}</p>
        {subject.code && (
          <p className="text-xs text-muted-foreground">{subject.code}</p>
        )}
      </div>
      {subject.category && (
        <Badge variant="secondary" className={getCategoryColor(subject.category)}>
          {subject.category}
        </Badge>
      )}
      {action === "remove" && subject.topic_count !== undefined && subject.topic_count > 0 && (
        <Badge variant="outline">{subject.topic_count} topics</Badge>
      )}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* No max-h / flex / overflow on DialogContent — the project's
          forked DialogContent already wraps children in a ScrollArea
          (see .claude/skills/ui-invariants §1). Per-column ScrollAreas
          + min-h-0 + flex-col nested two scroll containers and made the
          dialog body unreachable. */}
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Manage Subjects for {gradeName}
          </DialogTitle>
          <DialogDescription>
            Assign or remove subjects for this grade. Only assigned subjects will appear in the syllabus.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Available Subjects */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">Available Subjects ({availableSubjects.length})</h3>
                {selectedToAdd.size > 0 && (
                  <Button
                    size="sm"
                    onClick={handleAssignSelected}
                    disabled={isPending}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add ({selectedToAdd.size})
                  </Button>
                )}
              </div>
              <div className="border rounded-lg p-2">
                {availableSubjects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <Check className="h-8 w-8 text-green-500 mb-2" />
                    <p className="text-sm text-muted-foreground">All subjects assigned!</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableSubjects.map((subject) => (
                      <SubjectItem
                        key={subject.id}
                        subject={subject}
                        isChecked={selectedToAdd.has(subject.id)}
                        onToggle={() => handleToggleAdd(subject.id)}
                        action="add"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Assigned Subjects */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-sm">Assigned Subjects ({assignedSubjects.length})</h3>
                {selectedToRemove.size > 0 && (
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={handleRemoveSelected}
                    disabled={isPending}
                  >
                    <Minus className="h-4 w-4 mr-1" />
                    Remove ({selectedToRemove.size})
                  </Button>
                )}
              </div>
              <div className="border rounded-lg p-2">
                {assignedSubjects.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <BookOpen className="h-8 w-8 text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">No subjects assigned yet</p>
                    <p className="text-xs text-muted-foreground">Select from available subjects</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {assignedSubjects.map((subject) => (
                      <SubjectItem
                        key={subject.id}
                        subject={subject}
                        isChecked={selectedToRemove.has(subject.id)}
                        onToggle={() => handleToggleRemove(subject.id)}
                        action="remove"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
