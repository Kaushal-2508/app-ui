import { useState, useEffect, useMemo } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers, GraduationCap, BookOpen, Building2, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { sortClassRows } from "@/lib/classSort";
import { extractGradeNumberFromClassName } from "@/lib/gradeLookup";

interface AddSchoolTopicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  teacherUserId?: string | null;
  coordinatorClassIds?: string[] | null;
}

const DIFFICULTY_LEVELS = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
];

type ClassRow = {
  id: string;
  name: string;
  section: string | null;
  academic_year: string;
};

export function AddSchoolTopicDialog({
  open,
  onOpenChange,
  institutionId,
  teacherUserId,
  coordinatorClassIds,
}: AddSchoolTopicDialogProps) {
  const queryClient = useQueryClient();

  // Form state — class name + multi-section
  const [selectedClassKey, setSelectedClassKey] = useState(""); // `${name}|${academic_year}`
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [topicName, setTopicName] = useState("");
  const [difficultyLevel, setDifficultyLevel] = useState("");
  const [learningOutcomes, setLearningOutcomes] = useState("");

  // Reset sections + subject when class changes
  useEffect(() => {
    setSelectedSectionIds([]);
    setSelectedSubjectId("");
  }, [selectedClassKey]);

  // Reset subject when section selection changes
  const sectionKey = selectedSectionIds.slice().sort().join(",");
  useEffect(() => {
    setSelectedSubjectId("");
  }, [sectionKey]);

  // Fetch teacher's class assignments (if teacher)
  const {
    data: teacherAssignments = [],
    isLoading: teacherAssignmentsLoading,
  } = useQuery({
    queryKey: ["teacher-class-assignments", teacherUserId],
    queryFn: async () => {
      if (!teacherUserId) return [];
      const { data, error } = await supabase
        .from("class_assignments")
        .select("class_id, subject_id")
        .eq("user_id", teacherUserId)
        .eq("role", "teacher");
      if (error) throw error;
      return data || [];
    },
    enabled: open && !!teacherUserId,
  });

  // Fetch raw classes for this institution (unfiltered — filtering is applied below)
  const { data: rawClasses = [], isLoading: rawClassesLoading } = useQuery({
    queryKey: ["institution-classes-topics", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (error) throw error;
      return sortClassRows((data || []) as ClassRow[], (c) => c.name, (c) => c.section);
    },
    enabled: open && !!institutionId,
  });

  // Apply role-based filtering as a memo so it re-runs when teacherAssignments loads
  const classes = useMemo<ClassRow[]>(() => {
    let result = rawClasses;

    // Coordinator scope — only their assigned wing classes
    if (coordinatorClassIds) {
      if (coordinatorClassIds.length === 0) return [];
      const allowed = new Set(coordinatorClassIds);
      result = result.filter((c) => allowed.has(c.id));
    }

    // Teacher scope — only their assigned classes
    if (teacherUserId) {
      if (teacherAssignments.length === 0) return [];
      const assignedClassIds = new Set(teacherAssignments.map((a) => a.class_id));
      result = result.filter((c) => assignedClassIds.has(c.id));
    }

    return result;
  }, [rawClasses, coordinatorClassIds, teacherUserId, teacherAssignments]);

  const classesLoading =
    rawClassesLoading || (!!teacherUserId && teacherAssignmentsLoading);

  // Group classes by (name + academic_year) — each group exposes its sections
  const classGroups = useMemo(() => {
    const map = new Map<
      string,
      { key: string; name: string; academic_year: string; sections: ClassRow[] }
    >();
    for (const c of classes) {
      const key = `${c.name}|${c.academic_year}`;
      if (!map.has(key)) {
        map.set(key, { key, name: c.name, academic_year: c.academic_year, sections: [] });
      }
      map.get(key)!.sections.push(c);
    }
    // Sort sections within each group by section label
    for (const g of map.values()) {
      g.sections.sort((a, b) =>
        (a.section ?? "").localeCompare(b.section ?? "", undefined, { numeric: true })
      );
    }
    return [...map.values()];
  }, [classes]);

  const currentGroup = classGroups.find((g) => g.key === selectedClassKey);
  const availableSections = currentGroup?.sections ?? [];
  const allSectionsSelected =
    availableSections.length > 0 &&
    availableSections.every((s) => selectedSectionIds.includes(s.id));

  // Fetch subjects mapped across ALL selected sections (intersection)
  const { data: subjects = [], isLoading: subjectsLoading } = useQuery({
    queryKey: [
      "class-subjects-for-topic-multi",
      sectionKey,
      institutionId,
      teacherUserId,
    ],
    queryFn: async () => {
      if (selectedSectionIds.length === 0) return [];

      const { data: mappings, error } = await supabase
        .from("subject_class_mappings")
        .select(
          `
          subject_id,
          class_id,
          universal_subjects(id, name, code)
        `
        )
        .in("class_id", selectedSectionIds);

      if (error) throw error;

      const subjectsByClass = new Map<string, Set<string>>();
      const subjectDetails = new Map<string, { id: string; name: string; code: string | null }>();

      // PostgREST returns the joined `universal_subjects` row as an object on a
      // single-FK join, but supabase-js typegen sometimes widens it to an array.
      // Normalize both shapes through a tiny pickOne helper instead of `any`.
      type SubjectJoin = { id: string; name: string; code: string | null };
      type MappingRow = { class_id: string; universal_subjects: SubjectJoin | SubjectJoin[] | null };
      const pickOne = <T,>(v: T | T[] | null): T | null =>
        Array.isArray(v) ? v[0] ?? null : v;

      for (const m of (mappings ?? []) as MappingRow[]) {
        const s = pickOne(m.universal_subjects);
        if (!s) continue;
        if (!subjectsByClass.has(m.class_id)) subjectsByClass.set(m.class_id, new Set());
        subjectsByClass.get(m.class_id)!.add(s.id);
        subjectDetails.set(s.id, { id: s.id, name: s.name, code: s.code });
      }

      // Only keep subjects mapped to EVERY selected section
      let commonSubjectIds: Set<string> | null = null;
      for (const classId of selectedSectionIds) {
        const subjectSet = subjectsByClass.get(classId) ?? new Set<string>();
        if (commonSubjectIds === null) {
          commonSubjectIds = new Set(subjectSet);
        } else {
          commonSubjectIds = new Set(
            [...commonSubjectIds].filter((id) => subjectSet.has(id))
          );
        }
      }

      let subjectList = [...(commonSubjectIds ?? [])]
        .map((id) => subjectDetails.get(id)!)
        .filter(Boolean);

      // Teacher filter — subject must be in teacher's assignments for every selected section
      if (teacherUserId && teacherAssignments.length > 0) {
        subjectList = subjectList.filter((s) =>
          selectedSectionIds.every((classId) =>
            teacherAssignments.some(
              (a) => a.class_id === classId && a.subject_id === s.id
            )
          )
        );
      }

      return subjectList;
    },
    enabled: selectedSectionIds.length > 0 && !!institutionId,
  });

  const toggleSection = (sectionId: string) => {
    setSelectedSectionIds((prev) =>
      prev.includes(sectionId) ? prev.filter((id) => id !== sectionId) : [...prev, sectionId]
    );
  };

  const toggleAllSections = () => {
    if (allSectionsSelected) {
      setSelectedSectionIds([]);
    } else {
      setSelectedSectionIds(availableSections.map((s) => s.id));
    }
  };

  // Add topic mutation with duplicate check
  const addTopicMutation = useMutation({
    mutationFn: async () => {
      if (!currentGroup) throw new Error("Please select a class.");
      if (selectedSectionIds.length === 0) {
        throw new Error("Please select at least one section.");
      }

      // Resolve grade_level_id from the class name. Numeric classes match
      // /\d+/; pre-school classes (Pre Nursery / Nursery / LKG / UKG) need
      // the named lookup in extractGradeNumberFromClassName.
      const gradeNumber = extractGradeNumberFromClassName(currentGroup.name);

      let gradeId: string | null = null;
      if (gradeNumber !== null) {
        const { data: gradeData } = await supabase
          .from("grade_levels")
          .select("id")
          .eq("grade_number", gradeNumber)
          .maybeSingle();

        gradeId = gradeData?.id || null;
      }

      if (!gradeId) {
        throw new Error(
          gradeNumber !== null
            ? `Grade ${gradeNumber} isn't set up yet. Ask your admin to add it before creating chapters.`
            : "We couldn't figure out the grade from this class name."
        );
      }

      // Check for duplicate topic
      const { data: existingTopics, error: checkError } = await supabase
        .from("syllabus_topics")
        .select("id, topic_name")
        .eq("grade_level_id", gradeId)
        .eq("subject_id", selectedSubjectId)
        .or(`institution_id.eq.${institutionId},institution_id.is.null`);

      if (checkError) throw checkError;

      const duplicate = existingTopics?.find(
        (t) => t.topic_name.toLowerCase() === topicName.trim().toLowerCase()
      );

      if (duplicate) {
        throw new Error("This topic already exists in this class and subject");
      }

      // Create the topic (stored once at grade_level_id+subject_id — applies
      // to all selected sections that share the subject mapping)
      const { data: topic, error: topicError } = await supabase
        .from("syllabus_topics")
        .insert({
          grade_level_id: gradeId,
          subject_id: selectedSubjectId,
          topic_name: topicName.trim(),
          topic_name_hindi: null,
          difficulty_level: difficultyLevel || null,
          learning_outcomes: learningOutcomes.trim() || null,
          institution_id: institutionId,
          is_active: true,
          display_order: 1,
        })
        .select()
        .single();

      if (topicError) throw topicError;
      return topic;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      const count = selectedSectionIds.length;
      toast.success(
        count > 1
          ? `Chapter added to ${count} sections`
          : "Chapter added successfully"
      );
      handleClose();
    },
    onError: (error: Error) => {
      if (
        error.message.includes("already exists") ||
        error.message.includes("isn't set up") ||
        error.message.includes("Please select")
      ) {
        toast.error(error.message);
      } else {
        toastError(error, {
          fallback: "Couldn't add the chapter.",
          context: "addSchoolTopic",
        });
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      !selectedClassKey ||
      selectedSectionIds.length === 0 ||
      !selectedSubjectId ||
      !topicName.trim()
    )
      return;
    addTopicMutation.mutate();
  };

  const handleClose = () => {
    resetForm();
    onOpenChange(false);
  };

  const resetForm = () => {
    setSelectedClassKey("");
    setSelectedSectionIds([]);
    setSelectedSubjectId("");
    setTopicName("");
    setDifficultyLevel("");
    setLearningOutcomes("");
  };

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId);

  const selectedSectionLabels = availableSections
    .filter((s) => selectedSectionIds.includes(s.id))
    .map((s) => s.section ?? "N/A");

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Add Chapter
          </DialogTitle>
          <DialogDescription>
            Add a new topic to a subject in your school's syllabus.
          </DialogDescription>
        </DialogHeader>

        {/* Context badges */}
        <div className="flex items-center gap-2 flex-wrap px-1 pb-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/80 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
            <Building2 className="h-3.5 w-3.5" />
            School Repository
          </div>
          {currentGroup && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/80 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
              <GraduationCap className="h-3.5 w-3.5" />
              {currentGroup.name}
              {selectedSectionLabels.length > 0 && ` · ${selectedSectionLabels.join(", ")}`}
            </div>
          )}
          {selectedSubject && (
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/80 bg-muted/30 px-2.5 py-1 rounded-md border border-border/50">
              <BookOpen className="h-3.5 w-3.5" />
              {selectedSubject.name}
            </div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          {/* Class Selector — pick a class (grade) */}
          <div className="space-y-2">
            <Label htmlFor="class" className="text-sm font-medium text-foreground/90">
              Select Class <span className="text-destructive">*</span>
            </Label>
            <SearchableSelect
              value={selectedClassKey}
              onValueChange={setSelectedClassKey}
              placeholder={classesLoading ? "Loading classes..." : "Select a class"}
              searchPlaceholder="Search classes..."
              options={classGroups.map((g) => ({
                value: g.key,
                label: `${g.name} (${g.academic_year})`,
              }))}
            />
          </div>

          {/* Sections Selector — multi-select sections of the chosen class */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium text-foreground/90">
                Select Sections <span className="text-destructive">*</span>
              </Label>
              {availableSections.length > 1 && (
                <button
                  type="button"
                  onClick={toggleAllSections}
                  className="text-xs text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                  disabled={!selectedClassKey}
                >
                  {allSectionsSelected ? "Clear all" : "Select all"}
                </button>
              )}
            </div>
            <div className="rounded-md border bg-transparent">
              {!selectedClassKey ? (
                <p className="text-sm text-muted-foreground p-3">
                  Select a class first
                </p>
              ) : availableSections.length === 0 ? (
                <p className="text-sm text-muted-foreground p-3">
                  No sections available for this class
                </p>
              ) : (
                <ScrollArea className="max-h-40">
                  <div className="p-2 grid grid-cols-2 gap-1.5">
                    {availableSections.map((sec) => {
                      const checked = selectedSectionIds.includes(sec.id);
                      const label = sec.section ?? "Default";
                      return (
                        <label
                          key={sec.id}
                          className="flex items-center gap-2 rounded-md border border-transparent hover:border-border/60 hover:bg-muted/40 px-2 py-1.5 cursor-pointer transition-colors"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleSection(sec.id)}
                          />
                          <span className="text-sm">
                            {currentGroup?.name} - {label}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
            {selectedClassKey &&
              availableSections.length > 0 &&
              selectedSectionIds.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Pick at least one section to continue.
                </p>
              )}
          </div>

          {/* Subject Selector */}
          <div className="space-y-2">
            <Label htmlFor="subject" className="text-sm font-medium text-foreground/90">
              Select Subject <span className="text-destructive">*</span>
            </Label>
            <SearchableSelect
              value={selectedSubjectId}
              onValueChange={setSelectedSubjectId}
              placeholder={
                selectedSectionIds.length === 0
                  ? "Select sections first"
                  : subjectsLoading
                  ? "Loading subjects..."
                  : subjects.length === 0
                  ? "No subjects shared across selected sections"
                  : "Select a subject"
              }
              searchPlaceholder="Search subjects..."
              options={subjects.map((s) => ({
                value: s.id,
                label: `${s.name}${s.code ? ` (${s.code})` : ""}`,
              }))}
              disabled={selectedSectionIds.length === 0 || subjects.length === 0}
            />
            {selectedSectionIds.length > 1 && subjects.length === 0 && !subjectsLoading && (
              <p className="text-xs text-muted-foreground">
                Only subjects mapped to every selected section appear here.
              </p>
            )}
          </div>

          {/* Topic Name */}
          <div className="space-y-2">
            <Label htmlFor="topicName" className="text-sm font-medium text-foreground/90">
              Chapter Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="topicName"
              value={topicName}
              onChange={(e) => setTopicName(e.target.value)}
              placeholder="e.g., Fractions and Decimals"
              className="bg-transparent hover:border-ring/30 transition-colors shadow-sm"
              required
            />
          </div>

          {/* Difficulty Level */}
          <div className="space-y-2">
            <Label htmlFor="difficulty" className="text-sm font-medium text-foreground/90">
              Difficulty Level
            </Label>
            <SearchableSelect
              value={difficultyLevel}
              onValueChange={setDifficultyLevel}
              placeholder="Select difficulty"
              searchPlaceholder="Search..."
              options={DIFFICULTY_LEVELS}
            />
          </div>

          {/* Learning Outcomes */}
          <div className="space-y-2">
            <Label htmlFor="learningOutcomes" className="text-sm font-medium text-foreground/90">
              Learning Outcomes
            </Label>
            <Textarea
              id="learningOutcomes"
              value={learningOutcomes}
              onChange={(e) => setLearningOutcomes(e.target.value)}
              placeholder="What students will learn from this topic..."
              rows={3}
              className="resize-none bg-transparent hover:border-ring/30 transition-colors shadow-sm"
            />
          </div>

          <DialogFooter className="pt-4 mt-2 border-t">
            <Button type="button" variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                !selectedClassKey ||
                selectedSectionIds.length === 0 ||
                !selectedSubjectId ||
                !topicName.trim() ||
                addTopicMutation.isPending
              }
            >
              {addTopicMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                "Add Chapter"
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
