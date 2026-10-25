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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Layers, BookOpen, ChevronDown, ChevronRight, Plus, Globe, School, Loader2, Search, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateSchoolData, invalidateUserAssignments } from "@/lib/queryKeys";
import { setStaffClassAssignments, grantTeacherRole } from "@/lib/staffAssignments";
import { deleteInstitutionSubject } from "@/lib/subjectAdmin";
import { formatClassName } from "@/lib/utils";
import { sortClassRows } from "@/lib/classSort";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useClassSubjects, useInvalidateClassSubjects, type ClassSubject } from "@/hooks/useClassSubjects";
import { AddSubjectPopover } from "./AddSubjectPopover";

interface AssignTeacherClassSubjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; full_name: string } | null;
  institutionId: string;
  coordinatorClassIds?: string[]; // Restrict class options for coordinators
  /**
   * When true the save ALSO grants the teacher role, in the same transaction
   * (grant_teacher_role). Used by Manage Administrators to turn an admin into
   * an admin who also teaches. Default false keeps every existing call site
   * on the plain assignment path.
   */
  grantRole?: boolean;
}

interface ClassSubjectPair {
  classId: string;
  subjectId: string;
  subjectSource: "global" | "institute";
}

// Subject row component with bulk select checkbox
function SubjectRow({
  subject,
  isSelected,
  onToggle,
  onDelete,
  canDelete,
  isBulkSelected,
  onBulkToggle,
  showBulkSelect,
}: {
  subject: ClassSubject;
  isSelected: boolean;
  onToggle: () => void;
  onDelete?: () => void;
  canDelete?: boolean;
  isBulkSelected?: boolean;
  onBulkToggle?: () => void;
  showBulkSelect?: boolean;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-y-1 gap-x-2 pl-2 cursor-pointer hover:bg-muted/50 rounded p-1.5 transition-colors group"
      onClick={onToggle}
    >
      {/* Bulk delete checkbox for custom subjects */}
      {showBulkSelect && subject.source === "institute" && onBulkToggle && (
        <Checkbox
          checked={isBulkSelected}
          onCheckedChange={onBulkToggle}
          onClick={(e) => e.stopPropagation()}
          className="border-destructive data-[state=checked]:bg-destructive data-[state=checked]:text-destructive-foreground"
        />
      )}

      {/* Name group: checkbox + icon + name. min-w-0 lets the name shrink
          and the badges to the right stay on the same row when there's
          space, or wrap to a second line on narrow viewports. The name
          itself uses line-clamp-2 so long titles like
          "Political Science - Contemporary World Politics" reveal a
          second line instead of getting clipped to ellipsis. items-start
          on this group keeps the checkbox/icon aligned to the first
          line of a wrapped name (rather than dropping to the middle of
          a 2-line block). */}
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          className="mt-0.5 shrink-0"
        />
        <BookOpen className="h-3 w-3 mt-1 text-muted-foreground shrink-0" />
        <span className="text-sm min-w-0 flex-1 break-words line-clamp-2 leading-snug">
          {subject.name}
        </span>
      </div>

      {/* Source badge */}
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
        <Badge variant="outline" className="text-[10px] shrink-0 max-w-[7rem] truncate">
          {subject.code}
        </Badge>
      )}

      {/* Delete button for custom subjects */}
      {canDelete && subject.source === "institute" && onDelete && !showBulkSelect && (
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete subject"
        >
          <Trash2 className="h-3 w-3 text-destructive" />
        </Button>
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
  onDeleteSubject,
  onBulkDeleteSubjects,
  bulkSelectedSubjects,
  onToggleBulkSelect,
  showBulkSelect,
  onToggleSelectAllForBulk,
}: {
  classId: string;
  institutionId: string;
  selectedPairs: ClassSubjectPair[];
  onTogglePair: (classId: string, subjectId: string, source: "global" | "institute") => void;
  onToggleAll: (classId: string, subjects: ClassSubject[]) => void;
  onDeleteSubject: (subject: ClassSubject) => void;
  onBulkDeleteSubjects?: (subjects: ClassSubject[]) => void;
  bulkSelectedSubjects?: Set<string>;
  onToggleBulkSelect?: (subjectId: string) => void;
  showBulkSelect?: boolean;
  onToggleSelectAllForBulk?: (classId: string, subjects: ClassSubject[]) => void;
}) {
  const { data: subjects, isLoading } = useClassSubjects(classId, institutionId);
  const invalidateClassSubjects = useInvalidateClassSubjects();

  const isPairSelected = (subjectId: string) =>
    selectedPairs.some((p) => p.classId === classId && p.subjectId === subjectId);

  const handleSubjectCreated = (subjectId: string) => {
    // Auto-select the newly created subject
    onTogglePair(classId, subjectId, "institute");
    // Refetch subjects
    invalidateClassSubjects(classId, institutionId);
  };

  if (isLoading) {
    return (
      <div className="border-t bg-muted/20 p-3 space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-3/4" />
        <Skeleton className="h-6 w-5/6" />
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
  const allInstituteSelectedForBulk = instituteSubjects.length > 0 && 
    instituteSubjects.every((s) => bulkSelectedSubjects?.has(s.id));

  return (
    <div className="border-t bg-muted/20 p-3 space-y-2">
      {/* Select all row */}
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

      {/* Global subjects section */}
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
              canDelete={false}
              showBulkSelect={showBulkSelect}
            />
          ))}
        </div>
      )}

      {/* Institute subjects section */}
      <div className="space-y-1">
        <div className="text-xs font-medium text-muted-foreground px-2 pt-2 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <School className="h-3 w-3" />
            Institute Subjects ({instituteSubjects.length})
          </div>
          <div className="flex items-center gap-1">
            {showBulkSelect && instituteSubjects.length > 0 && onToggleSelectAllForBulk && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs px-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSelectAllForBulk(classId, instituteSubjects);
                }}
              >
                {allInstituteSelectedForBulk ? "Deselect All" : "Select All"}
              </Button>
            )}
            <AddSubjectPopover
              classId={classId}
              institutionId={institutionId}
              onCreated={handleSubjectCreated}
            />
          </div>
        </div>
        {instituteSubjects.length > 0 ? (
          instituteSubjects.map((subject) => (
            <SubjectRow
              key={subject.id}
              subject={subject}
              isSelected={isPairSelected(subject.id)}
              onToggle={() => onTogglePair(classId, subject.id, subject.source)}
              onDelete={() => onDeleteSubject(subject)}
              canDelete={true}
              isBulkSelected={bulkSelectedSubjects?.has(subject.id)}
              onBulkToggle={() => onToggleBulkSelect?.(subject.id)}
              showBulkSelect={showBulkSelect}
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

export function AssignTeacherClassSubjectDialog({
  open,
  onOpenChange,
  user,
  institutionId,
  coordinatorClassIds,
  grantRole = false,
}: AssignTeacherClassSubjectDialogProps) {
  const [selectedPairs, setSelectedPairs] = useState<ClassSubjectPair[]>([]);
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [classSearch, setClassSearch] = useState("");
  const [subjectToDelete, setSubjectToDelete] = useState<ClassSubject | null>(null);
  const [showBulkSelect, setShowBulkSelect] = useState(false);
  const [bulkSelectedSubjects, setBulkSelectedSubjects] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false);
  const [removalConfirm, setRemovalConfirm] = useState<{ count: number; classes: string[] } | null>(null);
  const queryClient = useQueryClient();
  const invalidateClassSubjects = useInvalidateClassSubjects();

  // Fetch classes for this institution - filter by coordinatorClassIds if provided
  const { data: classes, isLoading: loadingClasses } = useQuery({
    queryKey: ["institution-classes-for-teacher-assign", institutionId, coordinatorClassIds],
    queryFn: async () => {
      // Presence of the prop is the scoping signal, not its length. `length > 0`
      // failed OPEN: a coordinator whose wing resolves to no classes fell
      // through to the whole institution's list (2026-09-18). Admins pass
      // undefined/null and are still unscoped.
      if (coordinatorClassIds) {
        if (coordinatorClassIds.length === 0) return [];
        const { data, error } = await supabase
          .from("classes")
          .select("id, name, section, academic_year")
          .in("id", coordinatorClassIds)
          .eq("is_active", true)
          .order("name");

        if (error) throw error;
        return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
      }

      // Admin - all classes
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

  // Filter classes by search
  const filteredClasses = classes?.filter((cls) => {
    const searchLower = classSearch.toLowerCase();
    const className = `${cls.name} ${cls.section || ""}`.toLowerCase();
    return className.includes(searchLower);
  });

  // Fetch existing assignments for this teacher
  const { data: existingAssignments, isLoading: loadingAssignments } = useQuery({
    queryKey: ["teacher-class-subject-assignments", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, subject_id")
        .eq("user_id", user.id)
        .eq("role", "teacher");

      if (error) throw error;
      return data
        .filter((a) => a.subject_id)
        .map((a) => ({
          classId: a.class_id,
          subjectId: a.subject_id!,
          subjectSource: "global" as const, // Default, actual source determined at load
        }));
    },
    enabled: !!user?.id && open,
  });

  // Reset search and bulk select when dialog opens/closes
  useEffect(() => {
    if (!open) {
      setClassSearch("");
      setShowBulkSelect(false);
      setBulkSelectedSubjects(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (existingAssignments) {
      setSelectedPairs(existingAssignments);
      // Expand classes that have assignments
      const classesWithAssignments = new Set(existingAssignments.map((a) => a.classId));
      setExpandedClasses(classesWithAssignments);
    }
  }, [existingAssignments]);

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
      // Deselect all subjects for this class
      setSelectedPairs((prev) => prev.filter((p) => p.classId !== classId));
    } else {
      // Select all subjects for this class
      const newPairs = subjects
        .filter((s) => !selectedPairs.some((p) => p.classId === classId && p.subjectId === s.id))
        .map((s) => ({ classId, subjectId: s.id, subjectSource: s.source }));
      setSelectedPairs((prev) => [...prev, ...newPairs]);
    }
  };

  const getSelectedCountForClass = (classId: string) => {
    return selectedPairs.filter((p) => p.classId === classId).length;
  };

  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("No user selected");

      // Granting mode: one RPC does the role row AND the assignments together,
      // attributed and audit-logged. Splitting them would leave a half-made
      // teacher behind whenever the second call failed (CLAUDE.md §9a).
      if (grantRole) {
        return grantTeacherRole(
          user.id,
          selectedPairs.map((p) => ({ class_id: p.classId, subject_id: p.subjectId })),
        );
      }

      // Single transaction server-side (set_staff_class_assignments): diffs
      // against current rows instead of delete-all-then-reinsert (which could
      // silently wipe every assignment when the reinsert failed), preserves
      // bare class-teacher links, syncs the §22 class-group subject catalog,
      // and writes a system_audit_logs row with the exact delta.
      return setStaffClassAssignments({
        userId: user.id,
        pairs: selectedPairs.map((p) => ({ class_id: p.classId, subject_id: p.subjectId })),
        role: "teacher",
        kind: "subject",
        // `?? null`, not a length test: an empty coordinator scope must stay an
        // empty scope through to the write helper, not become "unscoped".
        scopeClassIds: coordinatorClassIds ?? null,
      });
    },
    onSuccess: (result) => {
      if (grantRole) {
        toast.success(`${user?.full_name ?? "They"} can now teach as well as administrate`);
        // The granted user's own session reads roles from this key, and the
        // admin list needs the new Teacher badge.
        queryClient.invalidateQueries({ queryKey: ["user-role-info"] });
        queryClient.invalidateQueries({ queryKey: ["institution-admins"] });
      } else {
        toast.success(
          result.removed_count > 0
            ? `Assignments updated: ${result.added_count} added, ${result.removed_count} removed`
            : "Class and subject assignments updated",
        );
      }
      invalidateSchoolData(queryClient, institutionId);
      invalidateUserAssignments(queryClient, user?.id);
      queryClient.invalidateQueries({ queryKey: ["school-teachers"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-class-subject-assignments", user?.id] });
      onOpenChange(false);
    },
    onError: (error) => {
      toastError(error, {
        fallback: grantRole
          ? "Couldn't add the teacher role."
          : "Couldn't save the teacher's class and subject assignments.",
        context: grantRole ? "grantTeacherRole" : "updateTeacherAssignments",
      });
    },
  });

  // Delete subject mutation. One transactional RPC: it refuses global
  // subjects, names every blocker (homework/optional batches/remarks/locked
  // exams) BEFORE deleting anything, removes the subject's mappings (cascade)
  // and teacher assignments together, and audit-logs the result. The previous
  // client sequence deleted mappings + every teacher assignment for the
  // subject first and only then attempted the subject delete — a failure
  // there (RESTRICT FKs are common) left the school unassigned school-wide
  // with the subject still present, unaudited.
  const deleteSubjectMutation = useMutation({
    mutationFn: async (subjectId: string) => {
      await deleteInstitutionSubject(subjectId);
      return subjectId; // Return the deleted subject ID
    },
    onSuccess: (deletedSubjectId) => {
      toast.success("Subject deleted successfully");
      
      // Remove from selected pairs IMMEDIATELY using the returned ID
      setSelectedPairs(prev => prev.filter(p => p.subjectId !== deletedSubjectId));
      
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["institution-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-class-subject-assignments", user?.id] });
      invalidateClassSubjects();
      
      setSubjectToDelete(null);
    },
    onError: (error) => {
      toastError(error, { fallback: "Couldn't delete the subject.", context: "deleteSubjectFromClass" });
    },
  });

  const handleDeleteSubject = (subject: ClassSubject) => {
    setSubjectToDelete(subject);
  };

  const confirmDeleteSubject = () => {
    if (subjectToDelete) {
      deleteSubjectMutation.mutate(subjectToDelete.id);
    }
  };

  // Bulk delete mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: async (subjectIds: string[]) => {
      // Each subject is its own transaction, so one blocked subject stops the
      // run with a named reason instead of half-deleting the rest.
      const deleted: string[] = [];
      for (const subjectId of subjectIds) {
        await deleteInstitutionSubject(subjectId);
        deleted.push(subjectId);
      }
      return deleted;
    },
    onSuccess: (deletedIds) => {
      const count = deletedIds.length;
      toast.success(`${count} subject${count !== 1 ? "s" : ""} deleted successfully`);
      
      // Remove from selected pairs IMMEDIATELY using the returned IDs
      const deletedSet = new Set(deletedIds);
      setSelectedPairs(prev => prev.filter(p => !deletedSet.has(p.subjectId)));
      
      // Invalidate all relevant queries
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["institution-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-class-subject-assignments", user?.id] });
      invalidateClassSubjects();
      
      setBulkSelectedSubjects(new Set());
      setShowBulkDeleteConfirm(false);
      setShowBulkSelect(false);
    },
    onError: (error) => {
      toastError(error, { fallback: "Couldn't delete the selected subjects.", context: "bulkDeleteSubjects" });
    },
  });

  const toggleBulkSelect = (subjectId: string) => {
    setBulkSelectedSubjects(prev => {
      const next = new Set(prev);
      if (next.has(subjectId)) {
        next.delete(subjectId);
      } else {
        next.add(subjectId);
      }
      return next;
    });
  };

  const toggleSelectAllForBulk = (classId: string, subjects: ClassSubject[]) => {
    const instituteSubjects = subjects.filter(s => s.source === "institute");
    const allSelected = instituteSubjects.every(s => bulkSelectedSubjects.has(s.id));
    
    setBulkSelectedSubjects(prev => {
      const next = new Set(prev);
      if (allSelected) {
        // Deselect all institute subjects for this class
        instituteSubjects.forEach(s => next.delete(s.id));
      } else {
        // Select all institute subjects for this class
        instituteSubjects.forEach(s => next.add(s.id));
      }
      return next;
    });
  };

  const confirmBulkDelete = () => {
    if (bulkSelectedSubjects.size > 0) {
      bulkDeleteMutation.mutate(Array.from(bulkSelectedSubjects));
    }
  };

  // Destructive-save guard: a save silently removes every previously assigned
  // pair that is no longer ticked (including a save with nothing ticked, which
  // unassigns the teacher entirely). Surface that before it happens.
  const handleSaveClick = () => {
    // Presence, not length: an empty scope removes nothing rather than
    // treating the coordinator as unscoped.
    const scopeSet = coordinatorClassIds ? new Set(coordinatorClassIds) : null;
    const removals = (existingAssignments ?? []).filter(
      (e) =>
        (!scopeSet || scopeSet.has(e.classId)) &&
        !selectedPairs.some((p) => p.classId === e.classId && p.subjectId === e.subjectId),
    );
    if (removals.length === 0) {
      assignMutation.mutate();
      return;
    }
    const classNames = [
      ...new Set(
        removals.map((r) => {
          const cls = classes?.find((c) => c.id === r.classId);
          return cls ? formatClassName(cls.name, cls.section) : "another class";
        }),
      ),
    ];
    setRemovalConfirm({ count: removals.length, classes: classNames });
  };

  const isLoading = loadingClasses || loadingAssignments;

  // Count unique classes from selected pairs
  const uniqueClassCount = new Set(selectedPairs.map((p) => p.classId)).size;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg h-[85vh] flex flex-col p-0 gap-0">
        {/* Sticky Header — pr-12 reserves space for the absolute close X
            (positioned `right-4` by the shadcn DialogContent fork) so the
            description doesn't run under it on narrow viewports. */}
        <DialogHeader className="pl-6 pr-12 pt-6 pb-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            {grantRole ? "Add to teacher" : "Assign Classes & Subjects"}
          </DialogTitle>
          <DialogDescription>
            {grantRole ? (
              <>
                Pick the classes and subjects {user?.full_name} will teach. They keep full
                administrator access and can switch between Admin and Teacher views.
              </>
            ) : (
              <>Select which classes and subjects {user?.full_name} will teach.</>
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Content */}
        <ScrollArea className="flex-1">
          <div className="px-6 py-4 space-y-4">
            {/* Class Search */}
            {classes && classes.length > 5 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search classes..."
                  value={classSearch}
                  onChange={(e) => setClassSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            )}

            {isLoading ? (
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
                            onDeleteSubject={handleDeleteSubject}
                            bulkSelectedSubjects={bulkSelectedSubjects}
                            onToggleBulkSelect={toggleBulkSelect}
                            showBulkSelect={showBulkSelect}
                            onToggleSelectAllForBulk={toggleSelectAllForBulk}
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

        {/* Sticky Footer — stacks vertically below `sm` so the primary
            action ("Assign N Subjects") never gets clipped past the
            dialog's right edge on narrow viewports. The bulk-delete
            toggle lives on its own row underneath the cancel/save pair
            so the primary CTAs always stay visible. */}
        <DialogFooter className="px-6 py-4 border-t shrink-0">
          <div className="flex w-full flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
            {/* Bulk delete toggle */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant={showBulkSelect ? "destructive" : "outline"}
                size="sm"
                onClick={() => {
                  if (showBulkSelect && bulkSelectedSubjects.size > 0) {
                    setShowBulkDeleteConfirm(true);
                  } else {
                    setShowBulkSelect(!showBulkSelect);
                    if (!showBulkSelect) {
                      setBulkSelectedSubjects(new Set());
                    }
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {showBulkSelect
                  ? bulkSelectedSubjects.size > 0
                    ? `Delete ${bulkSelectedSubjects.size} Selected`
                    : "Cancel"
                  : "Bulk Delete"}
              </Button>
              {showBulkSelect && bulkSelectedSubjects.size === 0 && (
                <span className="text-xs text-muted-foreground">Select custom subjects to delete</span>
              )}
            </div>

            {/* Cancel + Save — full-width below sm so the primary action
                fits inside the dialog at 360px. */}
            <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="w-full sm:w-auto"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveClick}
                // Granting with nothing ticked would create an inert teacher:
                // no students, no roster, no exams. The RPC refuses it too.
                disabled={
                  assignMutation.isPending ||
                  showBulkSelect ||
                  isLoading ||
                  (grantRole && selectedPairs.length === 0)
                }
                className="w-full sm:w-auto"
              >
                {assignMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {grantRole ? "Adding..." : "Saving..."}
                  </>
                ) : grantRole ? (
                  "Add as teacher"
                ) : (
                  `Assign ${selectedPairs.length} Subject${selectedPairs.length !== 1 ? "s" : ""}`
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Delete Subject Confirmation Dialog */}
      <AlertDialog open={!!subjectToDelete} onOpenChange={(open) => !open && setSubjectToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Subject</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{subjectToDelete?.name}"? This will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Remove the subject from all classes</li>
                <li>Remove all teacher assignments for this subject</li>
                <li>Permanently delete the subject</li>
              </ul>
              <p className="mt-2 text-destructive font-medium">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDeleteSubject}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteSubjectMutation.isPending}
            >
              {deleteSubjectMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                "Delete Subject"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation Dialog */}
      <AlertDialog open={showBulkDeleteConfirm} onOpenChange={setShowBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {bulkSelectedSubjects.size} Subject{bulkSelectedSubjects.size !== 1 ? "s" : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {bulkSelectedSubjects.size} selected subject{bulkSelectedSubjects.size !== 1 ? "s" : ""}? This will:
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Remove the subjects from all classes</li>
                <li>Remove all teacher assignments for these subjects</li>
                <li>Permanently delete the subjects</li>
              </ul>
              <p className="mt-2 text-destructive font-medium">This action cannot be undone.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmBulkDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={bulkDeleteMutation.isPending}
            >
              {bulkDeleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                `Delete ${bulkSelectedSubjects.size} Subject${bulkSelectedSubjects.size !== 1 ? "s" : ""}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Destructive-save confirmation: saving would remove existing assignments */}
      <AlertDialog open={!!removalConfirm} onOpenChange={(o) => !o && setRemovalConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removalConfirm?.count} existing assignment{removalConfirm?.count !== 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Saving will remove {removalConfirm?.count} of {user?.full_name}'s current subject
              assignment{removalConfirm?.count !== 1 ? "s" : ""} in: {removalConfirm?.classes.join(", ")}.
              The teacher will lose access to those subjects, classes and their exam views until
              reassigned.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Go back</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={assignMutation.isPending}
              onClick={() => {
                setRemovalConfirm(null);
                assignMutation.mutate();
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
