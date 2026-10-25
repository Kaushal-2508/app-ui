import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Loader2, Plus } from "lucide-react";
import { useAddInstituteSubject } from "@/hooks/useInstituteSyllabus";
import { useInvalidateClassSubjects } from "@/hooks/useClassSubjects";
import {
  generateSubjectCode,
  loadSubjectCodeContext,
  resolveClassGroupIdFromClassId,
} from "@/lib/subjectCode";

interface AddSubjectPopoverProps {
  classId: string;
  institutionId: string;
  onCreated: (subjectId: string) => void;
  triggerClassName?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
}

/**
 * Inline "+" button that opens a popover to create a new institute-specific
 * subject mapped to the given class's class_group. The subject code is
 * auto-generated from the name + class grade_number — admins no longer type it.
 */
export function AddSubjectPopover({
  classId,
  institutionId,
  onCreated,
  triggerClassName = "h-6 w-6 p-0 hover:bg-primary/10",
  align = "end",
  side = "right",
}: AddSubjectPopoverProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isOptional, setIsOptional] = useState(false);
  const addSubject = useAddInstituteSubject();
  const invalidateClassSubjects = useInvalidateClassSubjects();
  const queryClient = useQueryClient();

  // Pull grade_number + existing institution codes so we can show a preview
  // that matches what the DB will actually store. Only runs while open.
  const { data: codeContext } = useQuery({
    queryKey: ["subject-code-context", institutionId, classId],
    queryFn: async () => {
      const classGroupId = await resolveClassGroupIdFromClassId(classId);
      if (!classGroupId) return null;
      return loadSubjectCodeContext({ institutionId, classGroupId });
    },
    enabled: open && !!classId && !!institutionId,
    staleTime: 15_000,
  });

  const previewCode =
    name.trim() && codeContext
      ? generateSubjectCode({
          name,
          gradeNumber: codeContext.gradeNumber,
          gradeName: codeContext.gradeName,
          existingCodes: codeContext.existingCodes,
        })
      : null;

  useEffect(() => {
    if (!open) {
      setName("");
      setIsOptional(false);
    }
  }, [open]);

  const handleCreate = async () => {
    if (!name.trim()) return;

    try {
      const result = await addSubject.mutateAsync({
        name: name.trim(),
        institutionId,
        classId,
        isOptional,
      });

      invalidateClassSubjects(classId, institutionId);
      queryClient.invalidateQueries({
        queryKey: ["class-subject-mappings", institutionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["subject-code-context", institutionId],
      });
      onCreated(result.id);
      setOpen(false);
    } catch {
      // Error surfaced by useAddInstituteSubject's onError toast.
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={triggerClassName}
          title="Add new subject"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align={align} side={side}>
        <div className="space-y-3">
          <div className="font-medium text-sm">Add New Subject</div>
          <Input
            placeholder="Subject name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <div className="text-xs text-muted-foreground min-h-[1rem]">
            {previewCode ? (
              <>
                Code: <span className="font-mono text-foreground">{previewCode}</span>
              </>
            ) : (
              "Code will be generated from the name and class."
            )}
          </div>
          <div className="flex items-center justify-between rounded-md border p-2">
            <div className="min-w-0">
              <Label htmlFor="add-subject-optional" className="text-xs font-medium">
                Optional subject
              </Label>
              <p className="text-[11px] text-muted-foreground">Students enroll individually.</p>
            </div>
            <Switch
              id="add-subject-optional"
              checked={isOptional}
              onCheckedChange={setIsOptional}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              className="flex-1"
              onClick={handleCreate}
              disabled={!name.trim() || addSubject.isPending}
            >
              {addSubject.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Adding...
                </>
              ) : (
                "Add"
              )}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
