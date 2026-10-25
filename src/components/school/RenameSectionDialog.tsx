import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUpdateClass, type ClassData } from "@/hooks/useClasses";
import { useClassGroupSections } from "@/hooks/useClassGroups";

interface RenameSectionDialogProps {
  classData: ClassData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RenameSectionDialog({
  classData,
  open,
  onOpenChange,
}: RenameSectionDialogProps) {
  const [value, setValue] = useState("");
  const updateClass = useUpdateClass();

  const { data: siblings } = useClassGroupSections(classData?.class_group_id ?? null);

  useEffect(() => {
    if (open && classData) {
      setValue(classData.section ?? "");
    }
  }, [open, classData]);

  const trimmed = value.trim();

  const validationError = useMemo(() => {
    if (!classData) return null;
    if (!trimmed) return "Name can't be blank.";
    const lower = trimmed.toLowerCase();
    const collides = (siblings ?? []).some(
      (s) =>
        s.id !== classData.id &&
        (s.section ?? "").trim().toLowerCase() === lower,
    );
    if (collides) {
      return `A section called "${trimmed}" already exists in ${classData.name}. Pick a different name.`;
    }
    return null;
  }, [classData, siblings, trimmed]);

  const handleSubmit = async () => {
    if (!classData || validationError) return;
    try {
      await updateClass.mutateAsync({
        id: classData.id,
        name: classData.name,
        section: trimmed,
        academic_year: classData.academic_year,
        is_active: classData.is_active ?? true,
      });
      onOpenChange(false);
    } catch {
      // toast surfaced by useUpdateClass.onError; keep dialog open
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename section</DialogTitle>
          <DialogDescription>
            {classData
              ? `Renaming a section in ${classData.name}. The new name shows everywhere this section appears.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="section-name">Section name</Label>
          <Input
            id="section-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="A, Morning Batch, Aurora..."
            autoFocus
          />
          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!!validationError || updateClass.isPending}
          >
            {updateClass.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
