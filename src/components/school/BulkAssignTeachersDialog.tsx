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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Layers,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Plus,
  Globe,
  School,
  Loader2,
  Users,
  Search,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invalidateSchoolData } from "@/lib/queryKeys";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useClassSubjects, useInvalidateClassSubjects, type ClassSubject } from "@/hooks/useClassSubjects";
import { useAddInstituteSubject } from "@/hooks/useInstituteSyllabus";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

interface BulkAssignTeachersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teachers: Array<{ id: string; full_name: string; email: string }>;
  institutionId: string;
}

interface ClassSubjectPair {
  classId: string;
  subjectId: string;
  subjectSource: "global" | "institute";
}

// Inline Add Subject Popover Component
function AddSubjectPopover({
  classId,
  institutionId,
  onCreated,
}: {
  classId: string;
  institutionId: string;
  onCreated: (subjectId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const addSubject = useAddInstituteSubject();
  const invalidateClassSubjects = useInvalidateClassSubjects();

  const handleCreate = async () => {
    if (!name.trim()) return;

    try {
      const result = await addSubject.mutateAsync({
        name: name.trim(),
        institutionId,
      });

      invalidateClassSubjects(classId, institutionId);
      onCreated(result.id);
      setOpen(false);
      setName("");
      setCode("");
    } catch (error) {
      // Error handled by mutation
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-primary/10"
          title="Add new subject"
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="end" side="right">
        <div className="space-y-3">
          <div className="font-medium text-sm">Add New Subject</div>
          <Input
            placeholder="Subject name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="h-8 text-sm"
            autoFocus
          />
          <Input
            placeholder="Code (optional)"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={10}
            className="h-8 text-sm"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
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

// Subject row component
function SubjectRow({
  subject,
  isSelected,
  onToggle,
}: {
  subject: ClassSubject;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className="flex items-center gap-2 pl-2 cursor-pointer hover:bg-muted/50 rounded p-1.5 transition-colors"
      onClick={onToggle}
    >
      <Checkbox
        checked={isSelected}
        onCheckedChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <BookOpen className="h-3 w-3 text-muted-foreground shrink-0" />
      <span className="text-sm flex-1 truncate">{subject.name}</span>

      {subject.source === "global" ? (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 gap-1 border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0"
        >
          <Globe className="h-2.5 w-2.5" />
          Global
        </Badge>
      ) : (
        <Badge
          variant="secondary"
          className="text-[10px] px-1.5 py-0 gap-1 border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 shrink-0"
        >
          <School className="h-2.5 w-2.5" />
          Custom
        </Badge>
      )}

      {subject.code && (
        <Badge variant="outline" className="text-[10px] ml-1 shrink-0">
          {subject.code}
        </Badge>
      )}
    </div>
  );
}

// Class content with subjects
function ClassSubjectsContent({
  classId,
  institutionId,
  selectedPairs,
  onTogglePair,
  onToggleAll,
}: {
  classId: string;
  institutionId: string;
  selectedPairs: ClassSubjectPair[];
  onTogglePair: (classId: string, subjectId: string, source: "global" | "institute") => void;
  onToggleAll: (classId: string, subjects: ClassSubject[]) => void;
}) {
  const { data: subjects, isLoading } = useClassSubjects(classId, institutionId);
  const invalidateClassSubjects = useInvalidateClassSubjects();

  const isPairSelected = (subjectId: string) =>
    selectedPairs.some((p) => p.classId === classId && p.subjectId === subjectId);

  const handleSubjectCreated = (subjectId: string) => {
    onTogglePair(classId, subjectId, "institute");
    invalidateClassSubjects(classId, institutionId);
  };

  if (isLoading) {
    return (
      <div className="border-t bg-muted/20 p-3 space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
      </div>
    );
  }

  const globalSubjects = subjects?.global || [];
  const instituteSubjects = subjects?.institute || [];
  const allSubjects = subjects?.all || [];
  const hasSubjects = allSubjects.length > 0;

  if (!hasSubjects) {
    return (
      <div className="border-t bg-muted/20 p-4">
        <div className="text-center">
          <BookOpen className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No subjects available for this class.
          </p>
          <AddSubjectPopover
            classId={classId}
            institutionId={institutionId}
            onCreated={handleSubjectCreated}
          />
        </div>
      </div>
    );
  }

  const allSelected = allSubjects.every((s) => isPairSelected(s.id));

  return (
    <div className="border-t bg-muted/20 p-3 space-y-2">
      <div
        className="flex items-center gap-2 pb-2 border-b cursor-pointer hover:bg-muted/30 rounded p-1.5 -m-1.5 mb-2"
        onClick={() => onToggleAll(classId, allSubjects)}
      >
        <Checkbox
          checked={allSelected}
          onCheckedChange={() => onToggleAll(classId, allSubjects)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="text-sm font-medium text-muted-foreground">
          Select all subjects
        </span>
      </div>

      {globalSubjects.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-muted-foreground px-2 pt-1 flex items-center gap-1">
            <Globe className="h-3 w-3" />
            Global Subjects ({globalSubjects.length})
          </div>
          {globalSubjects.map((subject) => (
            <SubjectRow
              key={subject.id}
              subject={subject}
              isSelected={isPairSelected(subject.id)}
              onToggle={() => onTogglePair(classId, subject.id, subject.source)}
            />
          ))}
        </div>
      )}

      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground px-2 pt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <School className="h-3 w-3" />
            Institute Subjects ({instituteSubjects.length})
          </div>
          <AddSubjectPopover
            classId={classId}
            institutionId={institutionId}
            onCreated={handleSubjectCreated}
          />
        </div>
        {instituteSubjects.length > 0 ? (
          instituteSubjects.map((subject) => (
            <SubjectRow
              key={subject.id}
              subject={subject}
              isSelected={isPairSelected(subject.id)}
              onToggle={() => onTogglePair(classId, subject.id, subject.source)}
            />
          ))
        ) : (
          <p className="text-xs text-muted-foreground pl-2 py-1 italic">
            No custom subjects yet. Click + to add one.
          </p>
        )}
      </div>
    </div>
  );
}

export function BulkAssignTeachersDialog({
  open,
  onOpenChange,
  teachers,
  institutionId,
}: BulkAssignTeachersDialogProps) {
  const [selectedPairs, setSelectedPairs] = useState<ClassSubjectPair[]>([]);
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [classSearch, setClassSearch] = useState("");
  const queryClient = useQueryClient();

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setSelectedPairs([]);
      setExpandedClasses(new Set());
      setClassSearch("");
    }
  }, [open]);

  // Fetch classes for this institution
  const { data: classes, isLoading: loadingClasses } = useQuery({
    queryKey: ["institution-classes-for-bulk-assign", institutionId],
    queryFn: async () => {
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

  const filteredClasses = classes?.filter((cls) => {
    const searchLower = classSearch.toLowerCase();
    const className = `${cls.name} ${cls.section || ""}`.toLowerCase();
    return className.includes(searchLower);
  });

  const toggleClass = (classId: string) => {
    setExpandedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(classId)) {
        next.delete(classId);
      } else {
        next.add(classId);
      }
      return next;
    });
  };

  const togglePair = (classId: string, subjectId: string, source: "global" | "institute") => {
    setSelectedPairs((prev) => {
      const exists = prev.some((p) => p.classId === classId && p.subjectId === subjectId);
      if (exists) {
        return prev.filter((p) => !(p.classId === classId && p.subjectId === subjectId));
      } else {
        return [...prev, { classId, subjectId, subjectSource: source }];
      }
    });
  };

  const toggleAllSubjectsForClass = (classId: string, subjects: ClassSubject[]) => {
    const allSelected = subjects.every((s) =>
      selectedPairs.some((p) => p.classId === classId && p.subjectId === s.id)
    );

    if (allSelected) {
      setSelectedPairs((prev) => prev.filter((p) => p.classId !== classId));
    } else {
      const newPairs = subjects
        .filter((s) => !selectedPairs.some((p) => p.classId === classId && p.subjectId === s.id))
        .map((s) => ({ classId, subjectId: s.id, subjectSource: s.source }));
      setSelectedPairs((prev) => [...prev, ...newPairs]);
    }
  };

  const getSelectedCountForClass = (classId: string) => {
    return selectedPairs.filter((p) => p.classId === classId).length;
  };

  const bulkAssignMutation = useMutation({
    mutationFn: async () => {
      if (teachers.length === 0 || selectedPairs.length === 0) {
        throw new Error("No teachers or subjects selected");
      }

      // Create assignments for all teachers x all selected pairs
      const assignments = teachers.flatMap((teacher) =>
        selectedPairs.map((pair) => ({
          user_id: teacher.id,
          class_id: pair.classId,
          subject_id: pair.subjectId,
          role: "teacher" as const,
        }))
      );

      // Insert with upsert to avoid duplicates
      const { error } = await supabase
        .from("class_assignments")
        .upsert(assignments, {
          onConflict: "user_id,class_id,subject_id,role",
          ignoreDuplicates: true,
        });

      if (error) throw error;
    },
    onSuccess: () => {
      const totalAssignments = teachers.length * selectedPairs.length;
      toast.success(
        `Assigned ${selectedPairs.length} subject(s) to ${teachers.length} teacher(s) (${totalAssignments} total assignments)`
      );
      invalidateSchoolData(queryClient, institutionId);
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      onOpenChange(false);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to assign teachers");
    },
  });

  const uniqueClassCount = new Set(selectedPairs.map((p) => p.classId)).size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col p-0 gap-0">
        {/* Sticky Header */}
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Bulk Assign Classes & Subjects
          </DialogTitle>
          <DialogDescription>
            Assign the same classes and subjects to {teachers.length} selected teacher
            {teachers.length !== 1 ? "s" : ""}.
          </DialogDescription>

          {/* Selected teachers preview */}
          <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t">
            {teachers.slice(0, 5).map((teacher) => (
              <Badge key={teacher.id} variant="secondary" className="gap-1.5">
                <Avatar className="h-4 w-4">
                  <AvatarFallback className="text-[8px]">
                    {teacher.full_name.substring(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                {teacher.full_name}
              </Badge>
            ))}
            {teachers.length > 5 && (
              <Badge variant="outline">+{teachers.length - 5} more</Badge>
            )}
          </div>
        </DialogHeader>

        {/* Scrollable Content */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-4">
            {/* Class Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search classes..."
                value={classSearch}
                onChange={(e) => setClassSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {loadingClasses ? (
              <div className="space-y-2">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredClasses && filteredClasses.length > 0 ? (
              <div className="space-y-2">
                {filteredClasses.map((cls) => {
                  const isExpanded = expandedClasses.has(cls.id);
                  const selectedCount = getSelectedCountForClass(cls.id);

                  return (
                    <Collapsible
                      key={cls.id}
                      open={isExpanded}
                      onOpenChange={() => toggleClass(cls.id)}
                    >
                      <div className="border rounded-lg overflow-hidden">
                        <CollapsibleTrigger className="w-full">
                          <div className="flex items-center justify-between p-3 hover:bg-muted/50 transition-colors">
                            <div className="flex items-center gap-3">
                              {isExpanded ? (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              ) : (
                                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                              )}
                              <Layers className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {formatClassName(cls.name, cls.section)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {selectedCount > 0 && (
                                <Badge variant="default" className="text-xs">
                                  {selectedCount} subject{selectedCount !== 1 ? "s" : ""}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <ClassSubjectsContent
                            classId={cls.id}
                            institutionId={institutionId}
                            selectedPairs={selectedPairs}
                            onTogglePair={togglePair}
                            onToggleAll={toggleAllSubjectsForClass}
                          />
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  );
                })}
              </div>
            ) : classes && classes.length > 0 ? (
              <div className="py-8 text-center">
                <Search className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-muted-foreground">No classes match your search.</p>
              </div>
            ) : (
              <div className="py-8 text-center">
                <Layers className="h-10 w-10 mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-muted-foreground">No classes found in this institution.</p>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Sticky Footer */}
        <DialogFooter className="px-6 py-4 border-t shrink-0 gap-2 sm:gap-2">
          <div className="flex-1 text-sm text-muted-foreground">
            {selectedPairs.length > 0 && (
              <span>
                {selectedPairs.length} subject{selectedPairs.length !== 1 ? "s" : ""} × {teachers.length} teacher
                {teachers.length !== 1 ? "s" : ""} = {selectedPairs.length * teachers.length} assignments
              </span>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => bulkAssignMutation.mutate()}
            disabled={bulkAssignMutation.isPending || selectedPairs.length === 0}
          >
            {bulkAssignMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Assigning...
              </>
            ) : (
              `Assign to ${teachers.length} Teacher${teachers.length !== 1 ? "s" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
