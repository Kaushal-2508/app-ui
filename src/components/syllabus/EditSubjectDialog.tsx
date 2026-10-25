import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BookOpen, Loader2 } from "lucide-react";
import { useUpdateSchoolSubject } from "@/hooks/useManageSchoolSubject";
import { useToggleSubjectOptional } from "@/hooks/useClassGroupSubjects";
import { resolveClassGroupIdFromClassId } from "@/lib/subjectCode";
import { supabase } from "@/integrations/supabase/client";

const CATEGORY_OPTIONS = [
  { value: "core", label: "Core" },
  { value: "elective", label: "Elective" },
  { value: "language", label: "Language" },
  { value: "vocational", label: "Vocational" },
];
const NO_CATEGORY = "__none__";

interface EditSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject: { id: string; name: string; category: string | null; institutionId: string };
  classId: string;
  className?: string;
}

export function EditSubjectDialog({
  open,
  onOpenChange,
  subject,
  classId,
  className,
}: EditSubjectDialogProps) {
  const [name, setName] = useState(subject.name);
  const [category, setCategory] = useState<string>(subject.category?.toLowerCase() || NO_CATEGORY);
  const [isOptional, setIsOptional] = useState(false);
  const [initialOptional, setInitialOptional] = useState(false);
  const updateSubject = useUpdateSchoolSubject();
  const toggleOptional = useToggleSubjectOptional();

  // Current optional state + the class_group this subject maps to (school
  // subjects are mapped to exactly one class_group, so the flip is unambiguous).
  const { data: mapping } = useQuery({
    queryKey: ["subject-optional-state", subject.id, classId],
    queryFn: async (): Promise<{ classGroupId: string | null; isOptional: boolean }> => {
      const classGroupId = await resolveClassGroupIdFromClassId(classId);
      if (!classGroupId) return { classGroupId: null, isOptional: false };
      const { data } = await supabase
        .from("subject_class_group_mappings" as never)
        .select("is_optional")
        .eq("institution_id", subject.institutionId)
        .eq("class_group_id", classGroupId)
        .eq("subject_id", subject.id)
        .maybeSingle();
      const row = data as unknown as { is_optional: boolean } | null;
      return { classGroupId, isOptional: row?.is_optional ?? false };
    },
    enabled: open,
    staleTime: 15_000,
  });

  // Re-seed when the target subject changes (the dialog instance is reused).
  useEffect(() => {
    if (open) {
      setName(subject.name);
      setCategory(subject.category?.toLowerCase() || NO_CATEGORY);
    }
  }, [open, subject.id, subject.name, subject.category]);

  useEffect(() => {
    if (open && mapping) {
      setIsOptional(mapping.isOptional);
      setInitialOptional(mapping.isOptional);
    }
  }, [open, mapping]);

  const isSaving = updateSubject.isPending || toggleOptional.isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    updateSubject.mutate(
      {
        subjectId: subject.id,
        name: name.trim(),
        category: category === NO_CATEGORY ? null : category,
        institutionId: subject.institutionId,
        classId,
      },
      {
        onSuccess: async () => {
          if (isOptional !== initialOptional && mapping?.classGroupId) {
            await toggleOptional.mutateAsync({
              institution_id: subject.institutionId,
              class_group_id: mapping.classGroupId,
              subject_id: subject.id,
              is_optional: isOptional,
            });
          }
          onOpenChange(false);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Edit Subject
          </DialogTitle>
          <DialogDescription>
            Rename this subject or change its category{className ? ` for ${className}` : ""}.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="editSubjectName">Subject Name *</Label>
            <Input
              id="editSubjectName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Environmental Science"
              required
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="editSubjectCategory">Category</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id="editSubjectCategory">
                <SelectValue placeholder="Select a category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CATEGORY}>Uncategorized</SelectItem>
                {CATEGORY_OPTIONS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="space-y-0.5">
              <Label htmlFor="editSubjectOptional" className="text-sm font-medium cursor-pointer">
                Optional subject
              </Label>
              <p className="text-xs text-muted-foreground">
                Students enroll individually instead of the whole class taking it.
              </p>
            </div>
            <Switch
              id="editSubjectOptional"
              checked={isOptional}
              onCheckedChange={setIsOptional}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || isSaving}>
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save Changes"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
