import { useState, useMemo, useEffect, useCallback } from "react";
import { useExamClassHierarchy } from "@/hooks/useExamClassHierarchy";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useClassSubjects } from "@/hooks/useClassSubjects";
import { useTeacherAssignedSubjects } from "@/hooks/useTeacherAssignedSubjects";
import { useUserRole } from "@/hooks/useUserRole";
import { useChaptersForExam } from "@/hooks/useChaptersForExam";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AnimatedContainer } from "@/components/ui/animated-container";
import { StickyBottomCTA } from "../components/StickyBottomCTA";
import { ExamStepIndicator, type ExamWizardStep } from "../components/ExamStepIndicator";
import { SectionCard } from "../components/SectionCard";
import { ExamModeSubToggle } from "../components/ExamModeSubToggle";
import { UploadPaperPanel } from "../components/UploadPaperPanel";
import { Info, Plus, Layers, BookOpen, Camera, ChevronDown } from "lucide-react";
import type { ClassGroup, ClassSection } from "@/hooks/useExamClassHierarchy";
import type {
  ExamFormData,
  ExamSection,
  ExamMode,
  ExamType,
  HybridExamSettings,
} from "@/types/exam";
import { DEFAULT_HYBRID_SETTINGS } from "@/types/exam";

const EXAM_TYPE_OPTIONS: { value: ExamType; label: string }[] = [
  { value: "term", label: "Term exam" },
  { value: "unit", label: "Unit test" },
  { value: "weekly", label: "Weekly test" },
  { value: "unspecified", label: "Other / unspecified" },
];

interface ExamDetailsScreenProps {
  /** Steps the teacher may jump to from the header indicator. */
  reachableSteps?: ExamWizardStep[];
  onNavigateStep?: (step: ExamWizardStep) => void;
  formData: ExamFormData;
  updateMetadata: (patch: Partial<ExamFormData["metadata"]>) => void;
  updateContext: (patch: Partial<ExamFormData["context"]>) => void;
  addSection: (section: Omit<ExamSection, "tempId" | "sectionOrder">) => void;
  updateSection: (tempId: string, updates: Partial<ExamSection>) => void;
  removeSection: (tempId: string) => void;
  onContinue: () => void;
}

export function ExamDetailsScreen({
  reachableSteps,
  onNavigateStep,
  formData,
  updateMetadata,
  updateContext,
  addSection,
  updateSection,
  removeSection,
  onContinue,
}: ExamDetailsScreenProps) {
  // `useEffectiveInstitution` returns the current user's resolved institution
  // (teacher/admin's own, or the super-admin's currently-managed one). Prefer
  // form state once it's been seeded so edit-mode uses the exam's own
  // institution_id without a race against the seeding effect.
  const { institutionId: effectiveInstitutionId } = useEffectiveInstitution();
  const institutionId = formData.context.institutionId || effectiveInstitutionId || "";
  const { classGroups, isLoading: classesLoading } =
    useExamClassHierarchy(institutionId);

  const { data: roleInfo } = useUserRole();
  const isTeacher = !!roleInfo?.isTeacher;

  const selectedClassIds = formData.context.classIds;
  const primaryClassId = selectedClassIds[0] ?? null;

  // Admins/coordinators: subjects come from subject_class_mappings (the institution-wide mapping table).
  const { data: classSubjectsData, isLoading: classSubjectsLoading } =
    useClassSubjects(primaryClassId, institutionId ?? "");

  // Teachers: source of truth is class_assignments (what the admin actually granted them).
  const { data: teacherAssignments, isLoading: teacherAssignmentsLoading } =
    useTeacherAssignedSubjects();

  const subjectsLoading = isTeacher
    ? teacherAssignmentsLoading
    : classSubjectsLoading;

  const subjects = useMemo<Array<{ id: string; name: string }>>(() => {
    if (isTeacher) {
      if (!teacherAssignments || selectedClassIds.length === 0) return [];
      // Pick this teacher's assignments for any of the selected classes,
      // then dedupe by subjectId. Names come from the embedded universal_subjects join.
      const seen = new Map<string, { id: string; name: string }>();
      teacherAssignments.flat.forEach((a) => {
        if (!a.subjectId) return;
        if (!selectedClassIds.includes(a.classId)) return;
        if (seen.has(a.subjectId)) return;
        seen.set(a.subjectId, {
          id: a.subjectId,
          name: a.subjectName ?? "Subject",
        });
      });
      return Array.from(seen.values()).sort((a, b) =>
        a.name.localeCompare(b.name)
      );
    }
    // Admin / coordinator path: canonical subject_class_mappings.
    return classSubjectsData?.all ?? [];
  }, [isTeacher, teacherAssignments, classSubjectsData, selectedClassIds]);

  // Clear stale subject selection if the chosen subject is no longer available.
  //
  // An EMPTY options list must never trigger this. On "Continue draft" the form
  // hydrates with the saved subject before the class list / teacher assignments
  // resolve, so `subjects` is briefly [] — and this effect used to read that as
  // "the saved subject is invalid" and wipe subjectIds + chapterIds. The draft
  // then rendered as if nothing had been saved (Subject: "No subjects…",
  // Chapters: "Select class and subject first") even though the row was intact
  // in the DB, and the wipe persisted on the next save. Only treat the
  // selection as stale when we actually have a list to check it against.
  useEffect(() => {
    const current = formData.context.subjectIds[0];
    if (!current) return;
    if (subjectsLoading) return;
    if (subjects.length === 0) return;
    if (!subjects.some((s) => s.id === current)) {
      updateContext({ subjectIds: [], chapterIds: [] });
    }
  }, [subjects, subjectsLoading, formData.context.subjectIds, updateContext]);

  // ── Chapters (syllabus_topics) for the selected class + subject ──
  const selectedSubjectId = formData.context.subjectIds[0] ?? undefined;
  const { data: chapters, isLoading: chaptersLoading } = useChaptersForExam({
    classId: primaryClassId ?? undefined,
    subjectId: selectedSubjectId,
  });

  // Clear chapter selection when class or subject changes
  useEffect(() => {
    if (formData.context.chapterIds.length === 0) return;
    // If any selected chapter is no longer in the available list, reset
    if (!chapters || chaptersLoading) return;
    const availableIds = new Set(chapters.map((c) => c.id));
    const stillValid = formData.context.chapterIds.filter((id) =>
      availableIds.has(id)
    );
    if (stillValid.length !== formData.context.chapterIds.length) {
      updateContext({ chapterIds: stillValid });
    }
  }, [chapters, chaptersLoading, formData.context.chapterIds, updateContext]);

  const onToggleChapter = useCallback(
    (chapterId: string) => {
      const current = formData.context.chapterIds;
      const next = current.includes(chapterId)
        ? current.filter((id) => id !== chapterId)
        : [...current, chapterId];
      updateContext({ chapterIds: next });
    },
    [formData.context.chapterIds, updateContext]
  );

  const onToggleAllChapters = useCallback(() => {
    if (!chapters || chapters.length === 0) return;
    const allIds = chapters.map((c) => c.id);
    const allSelected = allIds.every((id) =>
      formData.context.chapterIds.includes(id)
    );
    updateContext({ chapterIds: allSelected ? [] : allIds });
  }, [chapters, formData.context.chapterIds, updateContext]);

  // Expanded section tracking
  const [expandedSectionId, setExpandedSectionId] = useState<string | null>(
    null
  );
  // Track the most recently added section so we can auto-focus its title
  const [autoFocusSectionId, setAutoFocusSectionId] = useState<string | null>(
    null
  );

  const allClassSections = useMemo(
    () => classGroups.flatMap((g) => g.sections),
    [classGroups]
  );

  // Multi-select is constrained to one class group at a time (e.g. only
  // sections of "Class 9" can be picked together, never 9A + 10B). The
  // "active group" is the className of whichever section is currently the
  // first selection — drives the disabled state on every OTHER group.
  const activeGroupName = useMemo<string | null>(() => {
    if (selectedClassIds.length === 0) return null;
    const firstId = selectedClassIds[0];
    for (const g of classGroups) {
      if (g.sections.some((s) => s.id === firstId)) return g.className;
    }
    return null;
  }, [selectedClassIds, classGroups]);

  const groupNameForSectionId = useCallback(
    (sectionId: string): string | null => {
      for (const g of classGroups) {
        if (g.sections.some((s) => s.id === sectionId)) return g.className;
      }
      return null;
    },
    [classGroups]
  );

  const onToggleClassSection = useCallback(
    (section: ClassSection, groupName: string) => {
      const isSelected = selectedClassIds.includes(section.id);
      // Block adding a section from a different group than the active one.
      // The popover already disables those rows visually, but keep this as a
      // belt-and-suspenders guard in case a keyboard-driven toggle slips through.
      if (!isSelected && activeGroupName && activeGroupName !== groupName) return;

      const next = isSelected
        ? selectedClassIds.filter((id) => id !== section.id)
        : [...selectedClassIds, section.id];

      const nextGroup =
        next.length > 0 ? groupNameForSectionId(next[0]) : null;

      // Group identity changed (cleared, switched, or freshly picked) → reset
      // chapter selection. Same-group additions/removals keep chapters since
      // the chapter list is identical across sections of one class_group.
      if (nextGroup !== activeGroupName) {
        updateContext({ classIds: next, chapterIds: [] });
      } else {
        updateContext({ classIds: next });
      }
    },
    [selectedClassIds, activeGroupName, groupNameForSectionId, updateContext]
  );

  const onToggleAllInGroup = useCallback(
    (group: ClassGroup) => {
      if (activeGroupName && activeGroupName !== group.className) return;
      const allInGroup = group.sections.map((s) => s.id);
      const allSelected = allInGroup.every((id) =>
        selectedClassIds.includes(id)
      );

      if (allSelected) {
        // Unchecking the group's "select all" clears every section in this
        // group — which empties the selection entirely (since other groups
        // were disabled). Clear chapters too.
        const next = selectedClassIds.filter((id) => !allInGroup.includes(id));
        if (next.length === 0) {
          updateContext({ classIds: [], chapterIds: [] });
        } else {
          updateContext({ classIds: next });
        }
      } else {
        // Selecting all in this group. If we're entering a new group (active
        // was null), reset chapters; otherwise keep them.
        const next = Array.from(new Set([...selectedClassIds, ...allInGroup]));
        if (activeGroupName !== group.className) {
          updateContext({ classIds: next, chapterIds: [] });
        } else {
          updateContext({ classIds: next });
        }
      }
    },
    [selectedClassIds, activeGroupName, updateContext]
  );

  const classTriggerLabel = useMemo(() => {
    if (classesLoading) return "Loading classes…";
    if (allClassSections.length === 0) return "No classes available";
    if (selectedClassIds.length === 0 || !activeGroupName) return "Pick a class";
    const activeGroup = classGroups.find((g) => g.className === activeGroupName);
    if (!activeGroup) return "Pick a class";
    const picked = activeGroup.sections.filter((s) =>
      selectedClassIds.includes(s.id)
    );
    const labels = picked.map((s) => s.displaySection ?? s.section ?? s.name);
    const visible = labels.slice(0, 3).join(", ");
    const more = labels.length > 3 ? ` (+${labels.length - 3})` : "";
    return `${activeGroupName}: ${visible}${more}`;
  }, [
    classesLoading,
    allClassSections.length,
    selectedClassIds,
    activeGroupName,
    classGroups,
  ]);

  const onSelectSubject = (subjectId: string) => {
    updateContext({ subjectIds: [subjectId], chapterIds: [] });
  };

  // Auto-select the class when the teacher only has one available — skips a
  // needless tap on the most common mobile path (single-class teacher).
  useEffect(() => {
    if (classesLoading) return;
    if (formData.context.classIds.length > 0) return;
    if (allClassSections.length === 1) {
      updateContext({ classIds: [allClassSections[0].id] });
    }
  }, [classesLoading, allClassSections, formData.context.classIds, updateContext]);

  // Same idea for subjects: if there's only one option under the chosen
  // class(es), pre-fill it so the teacher doesn't have to pick.
  useEffect(() => {
    if (subjectsLoading) return;
    if (formData.context.subjectIds.length > 0) return;
    if (selectedClassIds.length === 0) return;
    if (subjects.length === 1) {
      updateContext({ subjectIds: [subjects[0].id] });
    }
  }, [
    subjectsLoading,
    subjects,
    selectedClassIds,
    formData.context.subjectIds,
    updateContext,
  ]);

  const onModeChange = (mode: ExamMode) => {
    const patch: Partial<ExamFormData["metadata"]> = { examMode: mode };
    if (mode === "hybrid" && !formData.metadata.hybridSettings) {
      patch.hybridSettings = { ...DEFAULT_HYBRID_SETTINGS };
    }
    // Results-only only applies to offline; clear it for online/hybrid.
    if (mode !== "offline") patch.isResultsOnly = false;
    updateMetadata(patch);
  };

  const patchHybridSettings = (patch: Partial<HybridExamSettings>) => {
    const current = formData.metadata.hybridSettings ?? DEFAULT_HYBRID_SETTINGS;
    updateMetadata({ hybridSettings: { ...current, ...patch } });
  };

  // Add a new section and auto-expand it
  const handleAddSection = useCallback(() => {
    const sectionNumber = formData.sections.length + 1;
    const letter = String.fromCharCode(64 + sectionNumber);
    const title = `Section ${letter}`;

    addSection({
      title,
      description: "",
      instructions: "",
      defaultMarks: 1,
      negativeMarking: 0,
      questions: [],
      questionTypeCounts: {},
      questionTypeMarks: {},
      allowedQuestionTypes: [],
      sectionType: "mcq",
      chapterIds: [...formData.context.chapterIds],
    });

    // We need to expand the newly created section. Since we don't have the
    // tempId yet (it's generated inside addSection), we'll rely on the section
    // count changing and expand the last one.
    // Use a micro-delay so state has propagated.
    setTimeout(() => {
      setExpandedSectionId("__last__");
      setAutoFocusSectionId("__last__");
    }, 0);
  }, [formData.sections.length, addSection, formData.context.chapterIds]);

  // Keep each section's chapterIds in sync with the exam-level selection.
  // Per-section chapter picking was removed with SectionConfigSheet, so
  // sections should always mirror the exam's chapters.
  useEffect(() => {
    const examChapters = formData.context.chapterIds;
    formData.sections.forEach((s) => {
      const current = s.chapterIds ?? [];
      const sameLength = current.length === examChapters.length;
      const sameSet =
        sameLength && current.every((id) => examChapters.includes(id));
      if (!sameSet) {
        updateSection(s.tempId, { chapterIds: [...examChapters] });
      }
    });
  }, [formData.context.chapterIds, formData.sections, updateSection]);

  // Resolve "__last__" marker to actual section tempId
  useEffect(() => {
    if (expandedSectionId === "__last__" && formData.sections.length > 0) {
      const lastId = formData.sections[formData.sections.length - 1].tempId;
      setExpandedSectionId(lastId);
    }
  }, [expandedSectionId, formData.sections]);

  useEffect(() => {
    if (autoFocusSectionId === "__last__" && formData.sections.length > 0) {
      const lastId = formData.sections[formData.sections.length - 1].tempId;
      setAutoFocusSectionId(lastId);
    }
  }, [autoFocusSectionId, formData.sections]);

  const isResultsOnly =
    formData.metadata.examMode === "offline" &&
    formData.metadata.isResultsOnly === true;

  const canContinue =
    formData.metadata.title.trim().length > 0 &&
    formData.context.subjectIds.length > 0 &&
    formData.context.classIds.length > 0 &&
    formData.context.chapterIds.length > 0 &&
    (isResultsOnly || formData.sections.length > 0);

  // Compute total exam stats for the header
  const totalMarks = formData.sections.reduce((sum, s) => {
    const counts = s.questionTypeCounts || {};
    const marks = s.questionTypeMarks || {};
    return (
      sum +
      Object.entries(counts).reduce(
        (sectionSum, [type, count]) =>
          sectionSum + count * (marks[type] ?? 1),
        0
      )
    );
  }, 0);

  const totalQuestions = formData.sections.reduce((sum, s) => {
    return (
      sum +
      Object.values(s.questionTypeCounts || {}).reduce((a, b) => a + b, 0)
    );
  }, 0);

  return (
    <AnimatedContainer className="mx-auto max-w-4xl p-4 pb-28 space-y-6 md:p-8 md:pb-28">
      <header className="md:flex md:items-end md:justify-between md:gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground md:text-3xl">New exam</h1>
          <p className="text-sm text-muted-foreground md:text-base">
            Fill in the basics. You can still edit everything later.
          </p>
        </div>
        {/* Desktop step indicator */}
        <ExamStepIndicator
          current="details"
          reachable={reachableSteps ?? []}
          onNavigate={onNavigateStep ?? (() => {})}
        />
      </header>

      {/* ─── Basic info + Mode ─── */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Left column: Basic info */}
        <section className="space-y-4 md:rounded-xl md:border md:border-border md:bg-card md:p-6 md:shadow-sm">
          <div className="hidden md:block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Basic information</div>
          <div>
            <Label className="mb-1 block">Exam name</Label>
            <Input
              value={formData.metadata.title}
              onChange={(e) => updateMetadata({ title: e.target.value })}
              placeholder="Mid-term Mathematics"
              className="min-h-[44px]"
            />
          </div>

          <div>
            <Label className="mb-1 block">Exam type</Label>
            <Select
              value={formData.metadata.examType ?? "unit"}
              onValueChange={(value) =>
                updateMetadata({ examType: value as ExamType })
              }
            >
              <SelectTrigger className="min-h-[44px]">
                <SelectValue placeholder="Pick a type" />
              </SelectTrigger>
              <SelectContent>
                {EXAM_TYPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="mb-1 block">Class</Label>
              <ClassMultiSelectPopover
                classGroups={classGroups}
                selectedClassIds={selectedClassIds}
                activeGroupName={activeGroupName}
                triggerLabel={classTriggerLabel}
                disabled={classesLoading || allClassSections.length === 0}
                onToggleSection={onToggleClassSection}
                onToggleAllInGroup={onToggleAllInGroup}
              />
            </div>

            <div>
              <Label className="mb-1 block">Subject</Label>
              <Select
                value={formData.context.subjectIds[0] ?? ""}
                onValueChange={onSelectSubject}
                disabled={selectedClassIds.length === 0 || subjectsLoading}
              >
                <SelectTrigger className="min-h-[44px]">
                  <SelectValue
                    placeholder={
                      selectedClassIds.length === 0
                        ? "Select a class first"
                        : subjectsLoading
                          ? "Loading subjects…"
                          : subjects.length === 0
                            ? isTeacher
                              ? "No subjects assigned to you for this class"
                              : "No subjects mapped to this class"
                            : "Pick a subject"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── Chapters multi-select ── */}
          {primaryClassId && selectedSubjectId ? (
            <div>
              <Label className="mb-1.5 block">Chapters</Label>
              {chaptersLoading ? (
                <div className="rounded-lg border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                  Loading chapters…
                </div>
              ) : !chapters || chapters.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
                  <BookOpen className="inline h-4 w-4 mr-1.5 -mt-0.5" />
                  No chapters found for this subject. Add chapters in the Syllabus tab.
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-background">
                  {/* Select all header */}
                  <label className="flex items-center gap-2.5 px-3 py-2 border-b border-border cursor-pointer hover:bg-muted/30 transition-colors">
                    <Checkbox
                      checked={
                        chapters.length > 0 &&
                        chapters.every((c) =>
                          formData.context.chapterIds.includes(c.id)
                        )
                      }
                      onCheckedChange={onToggleAllChapters}
                    />
                    <span className="text-sm font-medium text-foreground">
                      Select all ({chapters.length})
                    </span>
                  </label>
                  {/* Chapter list */}
                  <div className="max-h-48 overflow-y-auto">
                    {chapters.map((ch) => (
                      <label
                        key={ch.id}
                        className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
                      >
                        <Checkbox
                          checked={formData.context.chapterIds.includes(ch.id)}
                          onCheckedChange={() => onToggleChapter(ch.id)}
                        />
                        <span className="text-sm text-foreground truncate">
                          {ch.chapterNumber != null
                            ? `Ch ${ch.chapterNumber}. ${ch.topicName}`
                            : ch.topicName}
                        </span>
                      </label>
                    ))}
                  </div>
                  {/* Selection summary */}
                  {formData.context.chapterIds.length > 0 && (
                    <div className="border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
                      {formData.context.chapterIds.length} of {chapters.length} selected
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div>
              <Label className="mb-1.5 block text-muted-foreground">Chapters</Label>
              <div className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-3 text-sm text-muted-foreground">
                Select class and subject first
              </div>
            </div>
          )}
        </section>

        {/* Right column: Mode and Sections */}
        <div className="space-y-6 flex flex-col">
          <section className="space-y-3 md:rounded-xl md:border md:border-border md:bg-card md:p-6 md:shadow-sm">
          <div className="hidden md:block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Exam mode</div>
          <Label className="md:hidden">Mode</Label>
          <div className="grid grid-cols-3 gap-2">
            {(["offline", "online", "hybrid"] as ExamMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onModeChange(mode)}
                className={`min-h-[48px] rounded-lg border px-3 text-sm font-medium transition-all duration-200 ${
                  formData.metadata.examMode === mode
                    ? "border-primary bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                    : "border-border bg-background text-foreground hover:bg-muted hover:border-primary/30"
                }`}
              >
                {mode === "offline" ? "Offline" : mode === "online" ? "Online" : "Hybrid"}
              </button>
            ))}
          </div>
          {formData.metadata.examMode === "online" && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                Online exams support objective question types only (MCQ, T/F,
                fill in the blanks, match the column).
              </span>
            </div>
          )}
          {formData.metadata.examMode === "hybrid" && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs text-primary">
              <Camera className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>
                Students write on paper, photograph their answer sheets, and upload from a
                phone paired by QR code. Teachers mark on-screen with annotations. Best for
                handwritten subjects, homework, and OSM 2026 practice.
              </span>
            </div>
          )}
          {formData.metadata.examMode === "hybrid" && (
            <HybridSettingsPanel
              settings={formData.metadata.hybridSettings ?? DEFAULT_HYBRID_SETTINGS}
              onChange={patchHybridSettings}
            />
          )}
          {formData.metadata.examMode === "offline" && (
            <ExamModeSubToggle
              value={formData.metadata.isResultsOnly === true}
              onChange={(v) => updateMetadata({ isResultsOnly: v })}
            />
          )}
        </section>

        {/* ─── Sections builder (Create Exam) OR paper upload (Already Created) ─── */}
        {isResultsOnly ? (
          <UploadPaperPanel
            institutionId={institutionId}
            files={formData.metadata.sourcePaperFiles ?? []}
            onChange={(f) => updateMetadata({ sourcePaperFiles: f })}
          />
        ) : (
        <section className="space-y-4 flex-1">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground md:text-base">
              <Layers className="h-4 w-4 text-primary md:h-5 md:w-5" />
              Paper sections
            </div>
            {formData.sections.length > 0 && (
              <div className="text-xs text-muted-foreground mt-0.5 md:text-sm">
                {formData.sections.length} section{formData.sections.length !== 1 ? "s" : ""}
                {" · "}
                {totalQuestions} questions
                {" · "}
                {totalMarks} marks
              </div>
            )}
          </div>
          {/* Desktop add section button in header */}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="hidden md:inline-flex gap-1.5 h-9"
            onClick={handleAddSection}
          >
            <Plus className="h-4 w-4" />
            Add section
          </Button>
        </div>

        {/* Section cards */}
        {formData.sections.length > 0 && (
          <div className="space-y-3">
            {formData.sections.map((s, i) => (
              <SectionCard
                key={s.tempId}
                section={s}
                index={i}
                examMode={formData.metadata.examMode}
                isExpanded={expandedSectionId === s.tempId}
                onToggleExpand={() =>
                  setExpandedSectionId((prev) =>
                    prev === s.tempId ? null : s.tempId
                  )
                }
                onUpdate={(updates) => updateSection(s.tempId, updates)}
                onDelete={() => {
                  removeSection(s.tempId);
                  if (expandedSectionId === s.tempId) {
                    setExpandedSectionId(null);
                  }
                }}
                autoFocus={autoFocusSectionId === s.tempId}
              />
            ))}
          </div>
        )}

        {/* ─── Add section card — mobile (hidden on desktop since we have the header button) ─── */}
        <button
          type="button"
          onClick={handleAddSection}
          className="group/add w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.07] hover:border-primary/50 transition-all duration-200 p-6 flex flex-col items-center justify-center gap-2 min-h-[100px] md:min-h-[80px] md:flex-row md:gap-3"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 group-hover/add:bg-primary/20 transition-colors md:h-9 md:w-9">
            <Plus className="h-5 w-5 text-primary md:h-4 md:w-4" />
          </div>
          <div className="text-center md:text-left">
            <div className="text-sm font-semibold text-primary">
              Add new section
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              {formData.sections.length === 0
                ? "Create your first section to get started"
                : "Add another section to your exam"}
            </div>
          </div>
        </button>
        </section>
        )}
        </div>
      </div>

      <StickyBottomCTA
        label={isResultsOnly ? "Continue to results" : "Continue to questions"}
        disabled={!canContinue}
        onClick={onContinue}
      />

    </AnimatedContainer>
  );
}

interface ClassMultiSelectPopoverProps {
  classGroups: ClassGroup[];
  selectedClassIds: string[];
  activeGroupName: string | null;
  triggerLabel: string;
  disabled: boolean;
  onToggleSection: (section: ClassSection, groupName: string) => void;
  onToggleAllInGroup: (group: ClassGroup) => void;
}

function ClassMultiSelectPopover({
  classGroups,
  selectedClassIds,
  activeGroupName,
  triggerLabel,
  disabled,
  onToggleSection,
  onToggleAllInGroup,
}: ClassMultiSelectPopoverProps) {
  const isEmpty = selectedClassIds.length === 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="flex min-h-[44px] w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className={isEmpty ? "text-muted-foreground" : "text-foreground truncate"}>
            {triggerLabel}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] min-w-[260px] p-0"
      >
        <div className="max-h-72 overflow-y-auto py-1">
          {classGroups.map((group) => {
            const groupSectionIds = group.sections.map((s) => s.id);
            const allInGroupSelected =
              groupSectionIds.length > 0 &&
              groupSectionIds.every((id) => selectedClassIds.includes(id));
            const someInGroupSelected = groupSectionIds.some((id) =>
              selectedClassIds.includes(id)
            );
            const groupDisabled =
              activeGroupName !== null && activeGroupName !== group.className;

            return (
              <div
                key={group.className}
                className={`px-1 py-1 ${groupDisabled ? "opacity-50" : ""}`}
              >
                <label
                  className={`flex items-center gap-2.5 rounded-sm px-2 py-1.5 ${
                    groupDisabled
                      ? "cursor-not-allowed"
                      : "cursor-pointer hover:bg-muted/40"
                  }`}
                >
                  <Checkbox
                    checked={
                      allInGroupSelected
                        ? true
                        : someInGroupSelected
                          ? "indeterminate"
                          : false
                    }
                    disabled={groupDisabled}
                    onCheckedChange={() => {
                      if (!groupDisabled) onToggleAllInGroup(group);
                    }}
                  />
                  <span className="text-sm font-semibold text-foreground">
                    {group.className}
                  </span>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {group.sections.length} section
                    {group.sections.length !== 1 ? "s" : ""}
                  </span>
                </label>
                {groupDisabled && (
                  <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                    Same class only. Clear selection to pick a different class.
                  </p>
                )}
                <div className="pl-5">
                  {group.sections.map((sec) => {
                    const checked = selectedClassIds.includes(sec.id);
                    return (
                      <label
                        key={sec.id}
                        className={`flex items-center gap-2.5 rounded-sm px-2 py-1.5 ${
                          groupDisabled
                            ? "cursor-not-allowed"
                            : "cursor-pointer hover:bg-muted/40"
                        }`}
                      >
                        <Checkbox
                          checked={checked}
                          disabled={groupDisabled}
                          onCheckedChange={() => {
                            if (!groupDisabled)
                              onToggleSection(sec, group.className);
                          }}
                        />
                        <span className="text-sm text-foreground truncate">
                          {sec.section
                            ? `Section ${sec.displaySection ?? sec.section}`
                            : sec.displayName}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        {selectedClassIds.length > 0 && (
          <div className="border-t border-border px-3 py-1.5 text-[11px] text-muted-foreground">
            {selectedClassIds.length} section
            {selectedClassIds.length !== 1 ? "s" : ""} selected
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

interface HybridSettingsPanelProps {
  settings: HybridExamSettings;
  onChange: (patch: Partial<HybridExamSettings>) => void;
}

function HybridSettingsPanel({ settings, onChange }: HybridSettingsPanelProps) {
  const graceClamped = Math.min(15, Math.max(3, settings.graceWindowMinutes));
  return (
    <div className="space-y-4 rounded-lg border border-border bg-background/60 p-3 md:p-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Hybrid settings
      </div>

      {/* Upload window */}
      <div>
        <div className="flex items-baseline justify-between gap-3">
          <Label className="text-sm">Upload window</Label>
          <span className="text-sm font-medium text-foreground tabular-nums">
            {graceClamped} min
          </span>
        </div>
        <Slider
          className="mt-2"
          min={3}
          max={15}
          step={1}
          value={[graceClamped]}
          onValueChange={(v) => onChange({ graceWindowMinutes: v[0] })}
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Time the student has to photograph and upload their answer sheets after they tap
          "I'm ready to submit" (or when the exam timer runs out). Default 5 minutes.
        </p>
      </div>

      {/* Max pages */}
      <div>
        <Label className="mb-1 block text-sm">Max pages per attempt</Label>
        <Input
          type="number"
          min={1}
          max={50}
          step={1}
          value={settings.maxPages}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) {
              onChange({ maxPages: Math.min(50, Math.max(1, Math.round(n))) });
            }
          }}
          className="min-h-[44px] w-32"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Hard cap on photographed pages a student can upload. Default 10.
        </p>
      </div>

      {/* Sheet numbering instruction */}
      <div>
        <Label className="mb-1 block text-sm">Sheet numbering instruction</Label>
        <Textarea
          value={settings.sheetNumberingInstruction}
          onChange={(e) => onChange({ sheetNumberingInstruction: e.target.value })}
          rows={2}
          className="min-h-[64px]"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Shown to the student before they start. Tells them how to number their answer sheets.
        </p>
      </div>

      {/* Camera proctoring toggle. This replaced a "Require face check at start"
          switch that promised webcam-to-photo matching which was never built and
          which nothing read: it was inert in both positions. */}
      <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-background px-3 py-2.5">
        <div>
          <Label className="text-sm">Require camera proctoring</Label>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {settings.requireCamera
              ? "Students must allow their camera before the paper appears, and snapshots are captured while they write."
              : "Students can start without a camera. Nothing is recorded, so this exam is not proctored."}
          </p>
        </div>
        <Switch
          checked={settings.requireCamera}
          onCheckedChange={(v) => onChange({ requireCamera: v })}
        />
      </div>
    </div>
  );
}
