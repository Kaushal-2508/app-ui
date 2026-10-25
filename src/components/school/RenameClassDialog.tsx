import { useEffect, useMemo, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useClassGroupSections,
  useInstitutionClassGroups,
  useUpdateClassGroup,
} from "@/hooks/useClassGroups";
import { type ClassData } from "@/hooks/useClasses";

interface RenameClassDialogProps {
  classData: ClassData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function RenameClassDialog({
  classData,
  open,
  onOpenChange,
}: RenameClassDialogProps) {
  const [value, setValue] = useState("");
  const updateGroup = useUpdateClassGroup();

  const { data: allGroups } = useInstitutionClassGroups(
    classData?.institution_id ?? null,
  );
  const { data: siblings } = useClassGroupSections(
    classData?.class_group_id ?? null,
  );

  useEffect(() => {
    if (open && classData) {
      setValue(classData.name);
    }
  }, [open, classData]);

  const trimmed = value.trim();

  const validationError = useMemo(() => {
    if (!classData) return null;
    if (!trimmed) return "Name can't be blank.";
    if (trimmed === classData.name) return null;
    const lower = trimmed.toLowerCase();
    const collides = (allGroups ?? []).some(
      (g) =>
        g.id !== classData.class_group_id &&
        g.academic_year === classData.academic_year &&
        g.name.trim().toLowerCase() === lower,
    );
    if (collides) {
      return `Another class is already named "${trimmed}" for ${classData.academic_year}. Pick a different name.`;
    }
    return null;
  }, [classData, allGroups, trimmed]);

  const sectionLabels = useMemo(() => {
    return (siblings ?? [])
      .map((s) => s.section?.trim())
      .filter((s): s is string => !!s);
  }, [siblings]);

  const handleConfirm = async () => {
    if (!classData?.class_group_id || validationError) return;
    if (trimmed === classData.name) {
      onOpenChange(false);
      return;
    }
    try {
      await updateGroup.mutateAsync({
        id: classData.class_group_id,
        name: trimmed,
      });
      onOpenChange(false);
    } catch {
      // toast surfaced by useUpdateClassGroup.onError; keep dialog open
    }
  };

  const sectionCount = sectionLabels.length;
  const sectionList = sectionLabels.join(", ");

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Rename class</AlertDialogTitle>
          <AlertDialogDescription>
            {classData ? (
              <>
                This will rename <strong>{classData.name}</strong> across{" "}
                {sectionCount === 0
                  ? "all its sections"
                  : `${sectionCount} section${sectionCount === 1 ? "" : "s"} (${sectionList})`}
                . The new name shows everywhere &mdash; students, teachers, exams, syllabus, dashboards.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-2 py-2">
          <Label htmlFor="class-name">Class name</Label>
          <Input
            id="class-name"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Class 10, Senior Secondary 10..."
            autoFocus
          />
          {validationError && (
            <p className="text-sm text-destructive">{validationError}</p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={!!validationError || updateGroup.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {updateGroup.isPending ? "Renaming..." : "Rename class"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
