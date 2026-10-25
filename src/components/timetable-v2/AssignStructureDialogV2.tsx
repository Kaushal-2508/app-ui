import { useEffect, useMemo, useState } from "react";
import { Loader2, Layers } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn, formatClassName } from "@/lib/utils";
import {
  useClassesForAssignmentV2,
  useAssignStructureToClassesV2,
  useUnassignStructureFromClassesV2,
} from "@/hooks/useTimetableV2";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The structure being assigned. */
  structureId: string;
  structureName: string;
  /** Academic year scope for the assignment (and for the class fetch). */
  academicYear: string;
}

export default function AssignStructureDialogV2({
  open,
  onOpenChange,
  structureId,
  structureName,
  academicYear,
}: Props) {
  const classesQuery = useClassesForAssignmentV2(open ? academicYear : "");
  const assignMut = useAssignStructureToClassesV2();
  const unassignMut = useUnassignStructureFromClassesV2();

  const groups = useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const allClasses = useMemo(() => groups.flatMap((g) => g.classes), [groups]);

  // Selected = the set the admin currently wants on this structure. Starts
  // pre-checked with whatever the DB already has on this structure, so a
  // no-op save doesn't surprise anyone.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    const initial = new Set<string>();
    for (const c of allClasses) {
      if (c.currentStructureId === structureId) initial.add(c.classId);
    }
    setSelected(initial);
  }, [open, structureId, allClasses]);

  function toggleClass(classId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) next.delete(classId);
      else next.add(classId);
      return next;
    });
  }

  function toggleWing(wingClassIds: string[]) {
    setSelected((prev) => {
      const next = new Set(prev);
      const allOn = wingClassIds.every((id) => next.has(id));
      if (allOn) {
        for (const id of wingClassIds) next.delete(id);
      } else {
        for (const id of wingClassIds) next.add(id);
      }
      return next;
    });
  }

  // Diff what we'll save: which classes get assigned (newly checked OR
  // switching from another structure) and which get unassigned (was on this
  // structure, now unchecked).
  const diff = useMemo(() => {
    const willAssign: string[] = [];
    const willUnassign: string[] = [];
    const willSwitch: string[] = [];
    for (const c of allClasses) {
      const isSelected = selected.has(c.classId);
      const wasOnThis = c.currentStructureId === structureId;
      if (isSelected && !wasOnThis) {
        if (c.currentStructureId) willSwitch.push(c.classId);
        willAssign.push(c.classId);
      } else if (!isSelected && wasOnThis) {
        willUnassign.push(c.classId);
      }
    }
    return { willAssign, willUnassign, willSwitch };
  }, [allClasses, selected, structureId]);

  const dirty = diff.willAssign.length > 0 || diff.willUnassign.length > 0;
  const isPending = assignMut.isPending || unassignMut.isPending;

  async function handleSave() {
    if (diff.willAssign.length > 0) {
      await assignMut.mutateAsync({
        structureId,
        classIds: diff.willAssign,
        academicYear,
      });
    }
    if (diff.willUnassign.length > 0) {
      await unassignMut.mutateAsync({
        classIds: diff.willUnassign,
        academicYear,
      });
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" data-dirty="true">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Assign &ldquo;{structureName}&rdquo; to classes
          </DialogTitle>
          <DialogDescription>
            Pick which classes use this structure for {academicYear}. Tap a wing
            heading to select all of its classes at once. Switching a class to
            this structure clears any cells it had on the previous structure.
          </DialogDescription>
        </DialogHeader>

        {/* Wrap body in a <form> so the SW dirty-form check
            (form[data-dirty="true"] in main.tsx) actually matches —
            the attribute on DialogContent's <div> is invisible to
            that selector. */}
        <form data-dirty="true" onSubmit={(e) => e.preventDefault()}>
        {classesQuery.isLoading ? (
          <div className="py-4 space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : groups.length === 0 ? (
          <Alert>
            <AlertDescription>
              No active classes in {academicYear}. Create classes first, then
              come back to assign a timetable.
            </AlertDescription>
          </Alert>
        ) : (
          // DialogContent already wraps children in a ScrollArea (see
          // .claude/skills/ui-invariants §1). Nesting another ScrollArea
          // here clipped the last wing — body scrolls via the outer
          // wrapper now.
          <div className="space-y-4 py-2">
              {groups.map((g) => {
                const wingClassIds = g.classes.map((c) => c.classId);
                const allOn = wingClassIds.every((id) => selected.has(id));
                const someOn = wingClassIds.some((id) => selected.has(id));
                return (
                  <div key={g.wingId ?? "__none__"} className="border rounded-lg overflow-hidden">
                    <div className="flex items-center gap-3 px-3 py-2 bg-muted/40 border-b">
                      <Checkbox
                        checked={allOn ? true : someOn ? "indeterminate" : false}
                        onCheckedChange={() => toggleWing(wingClassIds)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate text-sm">{g.wingName}</div>
                        <div className="text-xs text-muted-foreground">
                          {g.classes.length} class{g.classes.length === 1 ? "" : "es"}
                        </div>
                      </div>
                    </div>
                    <div className="divide-y">
                      {g.classes.map((c) => {
                        const isSelected = selected.has(c.classId);
                        const conflict =
                          isSelected &&
                          c.currentStructureId !== null &&
                          c.currentStructureId !== structureId;
                        return (
                          <Label
                            key={c.classId}
                            htmlFor={`assign-${c.classId}`}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 cursor-pointer",
                              "hover:bg-accent/30 transition-colors",
                            )}
                          >
                            <Checkbox
                              id={`assign-${c.classId}`}
                              checked={isSelected}
                              onCheckedChange={() => toggleClass(c.classId)}
                            />
                            <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium truncate">
                                {formatClassName(c.className, c.section)}
                              </span>
                              {c.currentStructureId === structureId ? (
                                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                                  Currently assigned
                                </Badge>
                              ) : c.currentStructureName ? (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px]",
                                    conflict && "bg-amber-50 text-amber-700 border-amber-200",
                                  )}
                                  title={conflict ? "Will switch from this structure. Its scheduled cells will be cleared." : undefined}
                                >
                                  Uses: {c.currentStructureName}
                                </Badge>
                              ) : null}
                              {c.publishStatus === "published" && (
                                <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">
                                  Published
                                </Badge>
                              )}
                            </div>
                          </Label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
        )}

        {(diff.willSwitch.length > 0 || diff.willUnassign.length > 0) && (
          <Alert className="bg-amber-50 border-amber-200 text-amber-900">
            <AlertDescription className="text-xs space-y-1">
              {diff.willSwitch.length > 0 && (
                <div>
                  <strong>{diff.willSwitch.length} class{diff.willSwitch.length === 1 ? "" : "es"}</strong> will switch from another structure. Their scheduled cells will be cleared.
                </div>
              )}
              {diff.willUnassign.length > 0 && (
                <div>
                  <strong>{diff.willUnassign.length} class{diff.willUnassign.length === 1 ? "" : "es"}</strong> will be unassigned. Scheduled cells will be cleared.
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!dirty || isPending}>
            {isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save assignments
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
