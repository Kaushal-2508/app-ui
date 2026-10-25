import { useState, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { BookOpen, GraduationCap, Building2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";
import { generateSubjectCode, loadSubjectCodeContext } from "@/lib/subjectCode";

interface AddSchoolSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  /**
   * When provided, the class-group selector is restricted to groups whose
   * sections fall within these class IDs (coordinator scope — only wing
   * classes). Passing an empty array means the coordinator has no assigned
   * classes and nothing will be shown. Omitting the prop entirely (admin
   * path) shows all institution classes.
   */
  coordinatorClassIds?: string[] | null;
}


export function AddSchoolSubjectDialog({
  open,
  onOpenChange,
  institutionId,
  coordinatorClassIds,
}: AddSchoolSubjectDialogProps) {
  const queryClient = useQueryClient();
  const [selectedClassGroupId, setSelectedClassGroupId] = useState("");
  const [subjectName, setSubjectName] = useState("");
  const [assignToAllClasses, setAssignToAllClasses] = useState(false);
  const [isOptional, setIsOptional] = useState(false);

  const isCoordinatorScope = Array.isArray(coordinatorClassIds);

  // Load class-groups. Writing at the group level fans out to every section
  // via the DB trigger (migration 20260423120000), so admins don't have to
  // toggle each section individually.
  const { data: allGroups = [], isLoading: classesLoading } =
    useInstitutionClassGroups(open ? institutionId : null);

  // Coordinators only see groups containing at least one of their wing classes.
  const classGroups = useMemo(() => {
    if (!isCoordinatorScope) return allGroups;
    if (!coordinatorClassIds || coordinatorClassIds.length === 0) return [];
    const allowed = new Set(coordinatorClassIds);
    return allGroups.filter((g) =>
      (g.section_ids ?? []).some((id) => allowed.has(id))
    );
  }, [allGroups, coordinatorClassIds, isCoordinatorScope]);

  // "Available to all classes" creates one universal_subjects row PER class_group
  // it lands in — the 20260501170000 trigger enforces one subject per class_group
  // and the 20260501160000 regen algorithm gives each a unique per-grade code.
  const addSubjectMutation = useMutation({
    mutationFn: async () => {
      const nameLower = subjectName.trim().toLowerCase();

      // Pick which class_groups we're writing into.
      const targetGroupIds =
        assignToAllClasses && !isCoordinatorScope
          ? allGroups.map((g) => g.id)
          : [selectedClassGroupId];

      if (targetGroupIds.length === 0) {
        throw new Error("No classes available to add this subject to.");
      }

      // Preflight duplicate-name check across every target class_group.
      const { data: existingMappings, error: checkError } = await supabase
        .from("subject_class_group_mappings" as never)
        .select("id, class_group_id, universal_subjects!inner(name, is_active)")
        .eq("institution_id", institutionId)
        .in("class_group_id", targetGroupIds);
      if (checkError) throw checkError;

      for (const row of (existingMappings ?? []) as Array<{
        class_group_id: string;
        universal_subjects: { name: string; is_active: boolean } | null;
      }>) {
        const us = row.universal_subjects;
        if (!us || !us.is_active) continue;
        if (us.name.trim().toLowerCase() === nameLower) {
          throw new Error("A subject with this name already exists in this class. Use a different name.");
        }
      }

      // Create a separate subject row per target class_group so each can carry
      // its own per-grade code. Keep running list of newly-generated codes to
      // avoid collisions within this batch.
      const newCodesThisBatch: string[] = [];
      let firstCreatedId: string | null = null;

      for (const classGroupId of targetGroupIds) {
        const ctx = await loadSubjectCodeContext({ institutionId, classGroupId });
        if (!ctx) {
          throw new Error("Can't read this class's grade. Ask your admin to check the class setup.");
        }

        const code = generateSubjectCode({
          name: subjectName,
          gradeNumber: ctx.gradeNumber,
          gradeName: ctx.gradeName,
          existingCodes: [...ctx.existingCodes, ...newCodesThisBatch],
        });
        newCodesThisBatch.push(code);

        const { data: subject, error: subjectError } = await supabase
          .from("universal_subjects")
          .insert({
            name: subjectName.trim(),
            code,
            institution_id: institutionId,
            is_active: true,
          })
          .select()
          .single();
        if (subjectError) throw subjectError;

        const { error: mappingError } = await supabase
          .from("subject_class_group_mappings" as never)
          .insert({
            class_group_id: classGroupId,
            subject_id: subject.id,
            institution_id: institutionId,
            is_optional: isOptional,
          } as never);
        if (mappingError) throw mappingError;

        if (!firstCreatedId) firstCreatedId = subject.id;
      }

      return { id: firstCreatedId };
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-code-context", institutionId] });
      toast.success("Subject added to class");
      handleClose();
    },
    onError: (error: Error) =>
      toastError(error, {
        fallback: "Couldn't add this subject.",
        context: "addSchoolSubject",
      }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClassGroupId || !subjectName.trim()) return;
    addSubjectMutation.mutate();
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setSelectedClassGroupId("");
    setSubjectName("");
    setAssignToAllClasses(false);
    setIsOptional(false);
  };

  const selectedClassGroup = classGroups.find((g) => g.id === selectedClassGroupId);

  // Pull the preview's grade + existing-codes context for the currently
  // selected class_group. The batch "all classes" mode doesn't show a single
  // preview because each target class_group will generate its own code.
  const previewTargetGroupId =
    !assignToAllClasses ? selectedClassGroupId : "";

  const { data: codeContext } = useQuery({
    queryKey: ["subject-code-context", institutionId, previewTargetGroupId],
    queryFn: async () => {
      if (!previewTargetGroupId) return null;
      return loadSubjectCodeContext({ institutionId, classGroupId: previewTargetGroupId });
    },
    enabled: open && !!previewTargetGroupId && !!institutionId,
    staleTime: 15_000,
  });

  const previewCode =
    subjectName.trim() && codeContext
      ? generateSubjectCode({
          name: subjectName,
          gradeNumber: codeContext.gradeNumber,
          gradeName: codeContext.gradeName,
          existingCodes: codeContext.existingCodes,
        })
      : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            Add Subject to Class
          </DialogTitle>
          <DialogDescription>
            Add a new subject to your school's repository and assign it to a class.
          </DialogDescription>
        </DialogHeader>

        {/* Context badges */}
        <div className="flex items-center gap-2 flex-wrap p-3 rounded-lg bg-muted/50">
          <Badge variant="outline" className="flex items-center gap-1">
            <Building2 className="h-3 w-3" />
            School Repository
          </Badge>
          {selectedClassGroup && (
            <Badge variant="secondary" className="flex items-center gap-1">
              <GraduationCap className="h-3 w-3" />
              {selectedClassGroup.name}
            </Badge>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Class Selector */}
          <div className="space-y-2">
            <Label htmlFor="class">Select Class *</Label>
            <SearchableSelect
              value={selectedClassGroupId}
              onValueChange={setSelectedClassGroupId}
              placeholder={
                classesLoading
                  ? "Loading classes..."
                  : classGroups.length === 0
                  ? isCoordinatorScope
                    ? "No classes assigned to your wing"
                    : "No classes available"
                  : "Select a class"
              }
              searchPlaceholder="Search classes..."
              options={classGroups.map((g) => ({
                value: g.id,
                label: `${g.name} (${g.academic_year})`,
              }))}
              disabled={!classesLoading && classGroups.length === 0}
            />
            {isCoordinatorScope && !classesLoading && classGroups.length === 0 && (
              <p className="text-xs text-muted-foreground">
                You'll only see classes from wings you're assigned to. Ask your
                admin if this looks wrong.
              </p>
            )}
            {selectedClassGroup && selectedClassGroup.section_count > 0 && (
              <p className="text-xs text-muted-foreground">
                Applies to all {selectedClassGroup.section_count} section
                {selectedClassGroup.section_count === 1 ? "" : "s"} under this class.
              </p>
            )}
          </div>

          {/* Subject Name */}
          <div className="space-y-2">
            <Label htmlFor="subjectName">Subject Name *</Label>
            <Input
              id="subjectName"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
              placeholder="e.g., Environmental Science"
              required
            />
            <p className="text-xs text-muted-foreground">
              {assignToAllClasses ? (
                <>A unique code will be generated for each class, e.g. <span className="font-mono">ENV10</span>, <span className="font-mono">ENV11</span>.</>
              ) : previewCode ? (
                <>Code: <span className="font-mono text-foreground">{previewCode}</span></>
              ) : subjectName.trim() && !selectedClassGroupId ? (
                "Pick a class to see the generated code."
              ) : (
                "Code will be generated from the name and class."
              )}
            </p>
          </div>

          {/* Assign to All Classes Toggle — admin-only.
              Coordinators are wing-scoped and can add the subject to one
              class at a time. */}
          {!isCoordinatorScope && (
            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
              <div className="space-y-0.5">
                <Label htmlFor="assignAll" className="text-sm font-medium cursor-pointer">
                  Available to all classes
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable to make this subject available in all classes
                </p>
              </div>
              <Switch
                id="assignAll"
                checked={assignToAllClasses}
                onCheckedChange={setAssignToAllClasses}
              />
            </div>
          )}

          {/* Optional subject toggle — students enroll individually. */}
          <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/30">
            <div className="space-y-0.5">
              <Label htmlFor="subjectOptional" className="text-sm font-medium cursor-pointer">
                Optional subject
              </Label>
              <p className="text-xs text-muted-foreground">
                Students enroll individually instead of the whole class taking it.
              </p>
            </div>
            <Switch
              id="subjectOptional"
              checked={isOptional}
              onCheckedChange={setIsOptional}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!selectedClassGroupId || !subjectName.trim() || addSubjectMutation.isPending}
            >
              {addSubjectMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Subject"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
