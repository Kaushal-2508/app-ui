import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Switch } from "@/components/ui/switch";
import { Plus, BookOpen, Trash2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { sortClassRows } from "@/lib/classSort";
import { formatClassName } from "@/lib/utils";
import { deleteInstitutionSubject } from "@/lib/subjectAdmin";

interface InstitutionSubjectsTabProps {
  institutionId: string;
}

interface SubjectWithClasses {
  id: string;
  name: string;
  code: string;
  category: string | null;
  isGlobal: boolean;
  classCount: number;
  classesMapped: Array<{ id: string; name: string; section: string | null }>;
}

export function InstitutionSubjectsTab({ institutionId }: InstitutionSubjectsTabProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>("");
  const [assignToAllClasses, setAssignToAllClasses] = useState(false);
  const [newSubjectName, setNewSubjectName] = useState("");
  const [newSubjectCode, setNewSubjectCode] = useState("");
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<string[]>([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [deleteType, setDeleteType] = useState<"mapping" | "full">("mapping");
  const queryClient = useQueryClient();

  // Fetch subjects already assigned to this institution (grouped by subject)
  const { data: institutionSubjects, isLoading, error: queryError } = useQuery({
    queryKey: ["institution-subjects", institutionId],
    queryFn: async (): Promise<SubjectWithClasses[]> => {
      if (!institutionId) {
        console.warn("InstitutionSubjectsTab: No institutionId provided");
        return [];
      }

      // Get unique subjects assigned to active classes in this institution
      // (archived years like 2025-26 are filtered out via classes.is_active).
      const { data: mappings, error } = await supabase
        .from("subject_class_mappings")
        .select(`
          subject_id,
          class_id,
          universal_subjects!inner(id, name, code, category, institution_id),
          classes!inner(id, name, section)
        `)
        .eq("institution_id", institutionId)
        .eq("classes.is_active", true);

      if (error) {
        console.error("Error fetching subject mappings:", error);
        throw error;
      }

      console.log(`Fetched ${mappings?.length || 0} subject-class mappings for institution ${institutionId}`);

      // PostgREST types an embedded row as T | T[] depending on how it infers
      // the relationship, so normalise both shapes before reading fields.
      type EmbeddedSubject = { id: string; name: string; code: string; category: string | null; institution_id: string | null };
      type EmbeddedClass = { id: string; name: string; section: string | null };
      type MappingRow = {
        subject_id: string;
        class_id: string;
        universal_subjects: EmbeddedSubject | EmbeddedSubject[] | null;
        classes: EmbeddedClass | EmbeddedClass[] | null;
      };
      const pickOne = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? v[0] ?? null : v);

      // Group by subject and count classes
      const subjectMap = new Map<string, SubjectWithClasses>();
      (mappings as unknown as MappingRow[] | null)?.forEach((m) => {
        const subject = pickOne(m.universal_subjects);
        const cls = pickOne(m.classes);
        if (subject && cls) {
          const existing = subjectMap.get(subject.id);
          const classInfo = {
            id: cls.id,
            name: cls.name,
            section: cls.section,
          };

          if (existing) {
            existing.classCount++;
            existing.classesMapped.push(classInfo);
          } else {
            subjectMap.set(subject.id, {
              id: subject.id,
              name: subject.name,
              code: subject.code,
              category: subject.category,
              isGlobal: subject.institution_id === null,
              classCount: 1,
              classesMapped: [classInfo],
            });
          }
        }
      });

      return Array.from(subjectMap.values()).sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!institutionId,
  });

  // Show error if query fails
  if (queryError) {
    console.error("Query error:", queryError);
  }

  // Fetch all global universal subjects for adding
  const { data: allSubjects } = useQuery({
    queryKey: ["global-subjects-for-mapping"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name, code, category")
        .is("institution_id", null) // Only global subjects
        .order("name");
      
      if (error) throw error;
      return data || [];
    },
    enabled: isAddDialogOpen,
  });

  // Get classes for mapping
  const { data: classes } = useQuery({
    queryKey: ["institution-classes-for-subjects", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: isAddDialogOpen,
  });

  // Add subjects to specific class(es)
  const addSubjectsMutation = useMutation({
    mutationFn: async ({ subjectIds, classIds }: { subjectIds: string[]; classIds: string[] }) => {
      if (classIds.length === 0) {
        throw new Error("Please select at least one class");
      }

      const mappings = [];
      for (const classId of classIds) {
        for (const subjectId of subjectIds) {
          mappings.push({
            institution_id: institutionId,
            class_id: classId,
            subject_id: subjectId,
          });
        }
      }

      const { error } = await supabase
        .from("subject_class_mappings")
        .upsert(mappings, { onConflict: "class_id,subject_id" });

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-subjects", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      const classLabel = assignToAllClasses ? "all classes" : "selected class";
      toast.success(`Subjects added to ${classLabel}`);
      resetDialog();
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Create new institute subject
  const createSubjectMutation = useMutation({
    mutationFn: async ({ name, code, classIds }: { name: string; code: string; classIds: string[] }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create the subject in universal_subjects with institution_id
      const { data: newSubject, error: subjectError } = await supabase
        .from("universal_subjects")
        .insert({
          name,
          code: code || name.substring(0, 4).toUpperCase(),
          institution_id: institutionId,
          created_by: user.id,
          is_active: true,
        })
        .select()
        .single();

      if (subjectError) throw subjectError;

      // Map to selected class(es)
      if (classIds.length > 0) {
        const mappings = classIds.map(classId => ({
          institution_id: institutionId,
          class_id: classId,
          subject_id: newSubject.id,
        }));

        const { error: mappingError } = await supabase
          .from("subject_class_mappings")
          .insert(mappings);

        if (mappingError) throw mappingError;
      }

      return newSubject;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["institution-subjects", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      const classLabel = assignToAllClasses ? "all classes" : "selected class";
      toast.success(`Subject created and added to ${classLabel}`);
      resetDialog();
    },
    onError: (error: Error) => {
      if (error.message.includes("duplicate")) {
        toast.error("A subject with this name already exists");
      } else {
        toast.error(error.message);
      }
    },
  });

  // Remove subject mappings only (keeps subject in universal_subjects)
  const removeSubjectMappingMutation = useMutation({
    mutationFn: async (subjectIds: string[]) => {
      const { error } = await supabase
        .from("subject_class_mappings")
        .delete()
        .eq("institution_id", institutionId)
        .in("subject_id", subjectIds);

      if (error) throw error;
    },
    onSuccess: (_, subjectIds) => {
      queryClient.invalidateQueries({ queryKey: ["institution-subjects", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      toast.success(`${subjectIds.length} subject(s) removed from classes`);
      setSelectedForDelete([]);
      setIsDeleteDialogOpen(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
    },
  });

  // Fully delete institute subjects (removes from universal_subjects too).
  // One transactional RPC per subject: it refuses global subjects, names every
  // blocker before deleting anything, and removes mappings + teacher
  // assignments in the same transaction as the subject itself. The previous
  // sequence wiped mappings and assignments first and could then fail on the
  // subject delete, leaving the school unassigned with the subject intact.
  const deleteSubjectsMutation = useMutation({
    mutationFn: async (subjectIds: string[]) => {
      const deleted: string[] = [];
      for (const subjectId of subjectIds) {
        await deleteInstitutionSubject(subjectId);
        deleted.push(subjectId);
      }
      return deleted;
    },
    onSuccess: (deleted) => {
      queryClient.invalidateQueries({ queryKey: ["institution-subjects", institutionId] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["class-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
      toast.success(`${deleted.length} subject(s) permanently deleted`);
      setSelectedForDelete([]);
      setIsDeleteDialogOpen(false);
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the selected subjects.", context: "deleteInstitutionSubjects" });
    },
  });

  const handleDelete = () => {
    if (deleteType === "full") {
      // Only delete institute subjects (not global)
      const instituteSubjectsToDelete = selectedForDelete.filter(id => {
        const subject = institutionSubjects?.find(s => s.id === id);
        return subject && !subject.isGlobal;
      });
      
      if (instituteSubjectsToDelete.length < selectedForDelete.length) {
        toast.warning("Global subjects cannot be deleted, only removed from classes");
      }
      
      if (instituteSubjectsToDelete.length > 0) {
        deleteSubjectsMutation.mutate(instituteSubjectsToDelete);
      }
      
      // Remove mappings for global subjects
      const globalSubjectsToRemove = selectedForDelete.filter(id => {
        const subject = institutionSubjects?.find(s => s.id === id);
        return subject?.isGlobal;
      });
      
      if (globalSubjectsToRemove.length > 0) {
        removeSubjectMappingMutation.mutate(globalSubjectsToRemove);
      }
    } else {
      removeSubjectMappingMutation.mutate(selectedForDelete);
    }
  };

  const toggleSelectForDelete = (subjectId: string) => {
    setSelectedForDelete(prev =>
      prev.includes(subjectId)
        ? prev.filter(id => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const toggleSelectAll = () => {
    if (selectedForDelete.length === institutionSubjects?.length) {
      setSelectedForDelete([]);
    } else {
      setSelectedForDelete(institutionSubjects?.map(s => s.id) || []);
    }
  };

  const resetDialog = () => {
    setIsAddDialogOpen(false);
    setSelectedSubjects([]);
    setSelectedClassId("");
    setAssignToAllClasses(false);
    setNewSubjectName("");
    setNewSubjectCode("");
    setIsCreatingNew(false);
  };

  const toggleSubject = (subjectId: string) => {
    setSelectedSubjects(prev =>
      prev.includes(subjectId)
        ? prev.filter(id => id !== subjectId)
        : [...prev, subjectId]
    );
  };

  const handleAddSubjects = () => {
    const classIds = assignToAllClasses 
      ? (classes?.map(c => c.id) || [])
      : selectedClassId ? [selectedClassId] : [];

    if (isCreatingNew) {
      if (!newSubjectName.trim()) {
        toast.error("Please enter a subject name");
        return;
      }
      createSubjectMutation.mutate({
        name: newSubjectName.trim(),
        code: newSubjectCode.trim(),
        classIds,
      });
    } else {
      if (selectedSubjects.length === 0) {
        toast.error("Please select at least one subject");
        return;
      }
      addSubjectsMutation.mutate({
        subjectIds: selectedSubjects,
        classIds,
      });
    }
  };

  // Filter out subjects already mapped to the selected class
  const getAvailableSubjects = () => {
    if (!allSubjects || !selectedClassId) return allSubjects || [];
    
    const mappedToClass = institutionSubjects
      ?.filter(s => s.classesMapped.some(c => c.id === selectedClassId))
      .map(s => s.id) || [];
    
    return allSubjects.filter(s => !mappedToClass.includes(s.id));
  };

  const availableSubjects = getAvailableSubjects();
  const canSubmit = isCreatingNew 
    ? newSubjectName.trim() && (assignToAllClasses || selectedClassId)
    : selectedSubjects.length > 0 && (assignToAllClasses || selectedClassId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (queryError) {
    return (
      <div className="p-4 text-center text-destructive">
        <AlertCircle className="h-8 w-8 mx-auto mb-2" />
        <p>Failed to load subjects. Please try again.</p>
        <Button 
          variant="outline" 
          size="sm" 
          className="mt-2"
          onClick={() => queryClient.invalidateQueries({ queryKey: ["institution-subjects", institutionId] })}
        >
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {institutionSubjects?.length || 0} subjects assigned
        </p>
        <div className="flex items-center gap-2">
          {selectedForDelete.length > 0 && (
            <Button 
              size="sm" 
              variant="destructive"
              onClick={() => setIsDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Delete ({selectedForDelete.length})
            </Button>
          )}
          <Button size="sm" onClick={() => setIsAddDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add Subjects
          </Button>
        </div>
      </div>

      {institutionSubjects && institutionSubjects.length > 0 ? (
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40px]">
                  <Checkbox
                    checked={selectedForDelete.length === institutionSubjects.length && institutionSubjects.length > 0}
                    onCheckedChange={toggleSelectAll}
                  />
                </TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-center">Classes</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {institutionSubjects.map(subject => (
                <TableRow key={subject.id} className={selectedForDelete.includes(subject.id) ? "bg-muted/50" : ""}>
                  <TableCell>
                    <Checkbox
                      checked={selectedForDelete.includes(subject.id)}
                      onCheckedChange={() => toggleSelectForDelete(subject.id)}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-muted-foreground" />
                      {subject.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{subject.code}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={subject.isGlobal ? "secondary" : "default"}>
                      {subject.isGlobal ? "🌍 Global" : "🏫 Custom"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="text-sm text-muted-foreground" title={subject.classesMapped.map(c => formatClassName(c.name, c.section)).join(', ')}>
                      {subject.classCount} class{subject.classCount !== 1 ? 'es' : ''}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedForDelete([subject.id]);
                        setIsDeleteDialogOpen(true);
                      }}
                      title="Delete subject"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 text-muted-foreground">
          No subjects assigned yet
        </div>
      )}

      {/* Add Subjects Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={(open) => !open && resetDialog()}>
        <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Subjects</DialogTitle>
            <DialogDescription>
              Add existing global subjects or create a new custom subject
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto space-y-4 py-4">
            {/* Class Selection */}
            <div className="space-y-3 p-3 rounded-lg border bg-muted/30">
              <Label className="text-sm font-medium">Assign To</Label>
              
              <div className="flex items-center gap-2">
                <Switch
                  id="assign-all"
                  checked={assignToAllClasses}
                  onCheckedChange={(checked) => {
                    setAssignToAllClasses(checked);
                    if (checked) setSelectedClassId("");
                  }}
                />
                <Label htmlFor="assign-all" className="text-sm cursor-pointer">
                  Assign to all {classes?.length || 0} classes
                </Label>
              </div>

              {!assignToAllClasses && (
                <SearchableSelect
                  value={selectedClassId}
                  onValueChange={setSelectedClassId}
                  placeholder="Select a class"
                  searchPlaceholder="Search classes..."
                  options={classes?.map(c => ({
                    value: c.id,
                    label: formatClassName(c.name, c.section),
                  })) || []}
                />
              )}

              {!assignToAllClasses && !selectedClassId && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" />
                  Please select a class to map subjects to
                </p>
              )}
            </div>

            {/* Toggle: Existing vs New */}
            <div className="flex gap-2">
              <Button
                variant={!isCreatingNew ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setIsCreatingNew(false)}
              >
                Use Existing
              </Button>
              <Button
                variant={isCreatingNew ? "default" : "outline"}
                size="sm"
                className="flex-1"
                onClick={() => setIsCreatingNew(true)}
              >
                Create New
              </Button>
            </div>

            {isCreatingNew ? (
              /* Create New Subject Form */
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>Subject Name</Label>
                  <Input
                    placeholder="e.g., Regional Studies"
                    value={newSubjectName}
                    onChange={(e) => setNewSubjectName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Subject Code (optional)</Label>
                  <Input
                    placeholder="e.g., REGS"
                    value={newSubjectCode}
                    onChange={(e) => setNewSubjectCode(e.target.value.toUpperCase())}
                    maxLength={10}
                  />
                </div>
              </div>
            ) : (
              /* Select Existing Subjects */
              <>
                {availableSubjects.length > 0 ? (
                  <div className="space-y-2">
                    {availableSubjects.map(subject => (
                      <div
                        key={subject.id}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedSubjects.includes(subject.id)
                            ? "bg-primary/10 border-primary"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => toggleSubject(subject.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={selectedSubjects.includes(subject.id)}
                            onCheckedChange={() => toggleSubject(subject.id)}
                          />
                          <div className="flex-1">
                            <p className="font-medium">{subject.name}</p>
                            <div className="flex gap-2 mt-1">
                              <Badge variant="outline" className="text-xs">{subject.code}</Badge>
                              <Badge variant="secondary" className="text-xs">🌍 Global</Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-muted-foreground">
                    {selectedClassId 
                      ? "All global subjects are already assigned to this class"
                      : "Select a class to see available subjects"}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="flex-shrink-0">
            <Button variant="outline" onClick={resetDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleAddSubjects}
              disabled={!canSubmit || addSubjectsMutation.isPending || createSubjectMutation.isPending}
            >
              {(addSubjectsMutation.isPending || createSubjectMutation.isPending) ? "Adding..." : (
                isCreatingNew 
                  ? "Create & Add" 
                  : `Add ${selectedSubjects.length} Subject${selectedSubjects.length !== 1 ? 's' : ''}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Subject(s)</DialogTitle>
            <DialogDescription>
              Choose how to handle the {selectedForDelete.length} selected subject(s)
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div 
              className={`p-4 rounded-lg border cursor-pointer transition-colors ${deleteType === "mapping" ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
              onClick={() => setDeleteType("mapping")}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  checked={deleteType === "mapping"}
                  onChange={() => setDeleteType("mapping")}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium">Remove from classes only</p>
                  <p className="text-sm text-muted-foreground">
                    Subjects will be removed from class mappings but remain available for future assignment
                  </p>
                </div>
              </div>
            </div>

            <div 
              className={`p-4 rounded-lg border cursor-pointer transition-colors ${deleteType === "full" ? "border-destructive bg-destructive/5" : "hover:bg-muted/50"}`}
              onClick={() => setDeleteType("full")}
            >
              <div className="flex items-start gap-3">
                <input
                  type="radio"
                  checked={deleteType === "full"}
                  onChange={() => setDeleteType("full")}
                  className="mt-1"
                />
                <div>
                  <p className="font-medium text-destructive">Permanently delete</p>
                  <p className="text-sm text-muted-foreground">
                    Custom subjects will be permanently deleted. Global subjects will only be removed from classes (cannot be deleted).
                  </p>
                </div>
              </div>
            </div>

            {selectedForDelete.length > 0 && (
              <div className="text-sm text-muted-foreground border-t pt-3">
                <p className="font-medium mb-2">Selected subjects:</p>
                <div className="flex flex-wrap gap-1">
                  {selectedForDelete.slice(0, 5).map(id => {
                    const subject = institutionSubjects?.find(s => s.id === id);
                    return subject ? (
                      <Badge key={id} variant={subject.isGlobal ? "secondary" : "outline"}>
                        {subject.isGlobal ? "🌍" : "🏫"} {subject.name}
                      </Badge>
                    ) : null;
                  })}
                  {selectedForDelete.length > 5 && (
                    <Badge variant="outline">+{selectedForDelete.length - 5} more</Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={removeSubjectMappingMutation.isPending || deleteSubjectsMutation.isPending}
            >
              {(removeSubjectMappingMutation.isPending || deleteSubjectsMutation.isPending) 
                ? "Deleting..." 
                : deleteType === "full" ? "Delete Permanently" : "Remove from Classes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
