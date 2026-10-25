import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import type { ExamWizardStep } from "./components/ExamStepIndicator";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isExamSlotConflictError } from "@/lib/examSlots";
import { useExamForm } from "@/hooks/useExamForm";
import { SAVE_EXAM_MUTATION_KEY, useSaveExam } from "@/hooks/useSaveExam";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import type {
  ExamFormData,
  ExamSection,
  SectionType,
  ExamMode,
  ResultVisibility,
  HybridExamSettings,
  ExamType,
} from "@/types/exam";
import { normalizeProctoringConfig } from "@/types/exam";
import {
  useExamLockStatus,
  useBumpExamVersion,
} from "@/hooks/useExamLockStatus";
import { buildDraftQuestionTree, type RawQuestionRow } from "./draftQuestionTree";
import { TemplatePickerSheet } from "./screens/TemplatePickerSheet";
import { ExamDetailsScreen } from "./screens/ExamDetailsScreen";
import { QuestionsScreen } from "./screens/QuestionsScreen";
import { ReviewPublishScreen } from "./screens/ReviewPublishScreen";
import { VersionWarningModal } from "./screens/VersionWarningModal";
import { ResultSetupSheet, type ResultSetupValues } from "./screens/ResultSetupSheet";
import { OfflineMarksEntryScreen } from "./screens/OfflineMarksEntryScreen";
import type { ExamTemplate, TemplateBlueprint, SourcePaperFile } from "@/types/exam";

type HybridSettingsRow = {
  grace_window_minutes: number;
  max_pages: number;
  /** Nullable here on purpose: the mapper below must treat absent as ON. */
  require_camera: boolean | null;
  sheet_numbering_instruction: string;
};

// Shapes of the nested joined rows returned by the exam-edit loader query.
// RawQuestionRow lives in ./draftQuestionTree next to the parent/child rebuild.
type RawSectionRow = {
  id: string;
  section_type: SectionType | null;
  title: string;
  description: string | null;
  instructions: string | null;
  section_order: number | null;
  default_marks: number | null;
  negative_marking: number | null;
  randomize_order: boolean | null;
  partial_marks_allowed: boolean | null;
  negative_marking_enabled: boolean | null;
  exam_questions: RawQuestionRow[] | null;
};
type RawLinkRow = {
  class_id: string;
  subject_id: string;
  topic_id: string | null;
  custom_topic_id: string | null;
};

function mapHybridSettings(value: unknown): HybridExamSettings | undefined {
  if (!value) return undefined;
  const row = (Array.isArray(value) ? value[0] : value) as
    | HybridSettingsRow
    | undefined;
  if (!row) return undefined;
  return {
    graceWindowMinutes: row.grace_window_minutes,
    maxPages: row.max_pages,
    // Older rows predate the column; the DB default is true and every row
    // existing at 2026-09-04 was backfilled true, so treat absent as ON rather
    // than silently unproctoring an exam.
    requireCamera: row.require_camera ?? true,
    sheetNumberingInstruction: row.sheet_numbering_instruction,
  };
}

/** Drop nulls and duplicates from a link-table id list, preserving order. */
function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id)));
}

/**
 * Direct Supabase loader for edit mode. Returns a fully-shaped ExamFormData
 * ready to pass to useExamForm.loadForm. Bypasses useExamEditor because that
 * hook manages its own form state which would conflict with ours.
 */
function useExamFormLoader(examId: string | undefined) {
  return useQuery({
    queryKey: ["exam-creation-edit-loader", examId],
    enabled: !!examId,
    queryFn: async (): Promise<ExamFormData> => {
      const { data, error } = await supabase
        .from("exams")
        .select(
          `
          *,
          exam_sections (
            id, title, description, instructions, section_order, section_type,
            default_marks, negative_marking,
            exam_questions (
              id, question_text, question_type, marks, negative_marks,
              options, correct_answer, explanation, difficulty_level, tags,
              question_order, image_url, parent_question_id
            )
          ),
          exam_classes (class_id),
          exam_subjects (subject_id),
          exam_topics (topic_id, custom_topic_id),
          hybrid_exam_settings (
            grace_window_minutes,
            max_pages,
            require_camera,
            sheet_numbering_instruction
          )
        `
        )
        .eq("id", examId!)
        .single();
      if (error) throw error;

      const row = data as unknown as Record<string, unknown>;

      const sections: ExamSection[] = ((row.exam_sections as RawSectionRow[]) || [])
        .sort((a, b) => (a.section_order ?? 0) - (b.section_order ?? 0))
        .map((s) => {
          // Comprehension / case-study parts nest under their parent here;
          // mapping the rows flat is the Task 1 bug (see draftQuestionTree).
          const questions = buildDraftQuestionTree(s.exam_questions as RawQuestionRow[] | null);

          // The section "plan" fields (questionTypeCounts / questionTypeMarks /
          // allowedQuestionTypes / expectedQuestionCount) are authoring-time
          // state that is NOT persisted on exam_sections. Reconstruct them from
          // the questions that WERE saved — otherwise a resumed draft reports
          // "0 questions · 0 marks" on the Details step (which counts the plan,
          // not section.questions) and the Questions step shows a target of 0,
          // making a fully authored paper look empty.
          const questionTypeCounts: Record<string, number> = {};
          const questionTypeMarks: Record<string, number> = {};
          questions.forEach((q) => {
            questionTypeCounts[q.questionType] =
              (questionTypeCounts[q.questionType] ?? 0) + 1;
            // Marks are per-question within a type group; last one wins, which
            // matches how the authoring UI treats a type group's marks.
            questionTypeMarks[q.questionType] = q.marks;
          });

          return {
            id: s.id,
            tempId: s.id,
            sectionType: s.section_type || "mcq",
            title: s.title,
            description: s.description || "",
            instructions: s.instructions || "",
            sectionOrder: s.section_order ?? 0,
            defaultMarks: s.default_marks || 1,
            negativeMarking: s.negative_marking || 0,
            randomizeOrder: s.randomize_order ?? false,
            partialMarksAllowed: s.partial_marks_allowed ?? false,
            negativeMarkingEnabled: s.negative_marking_enabled ?? false,
            questions,
            ...(questions.length > 0
              ? {
                  questionTypeCounts,
                  questionTypeMarks,
                  allowedQuestionTypes: Object.keys(questionTypeCounts) as ExamSection["allowedQuestionTypes"],
                  expectedQuestionCount: questions.length,
                }
              : {}),
          };
        });

      return {
        examId: row.id as string,
        context: {
          institutionId: (row.institution_id as string) || "",
          // Dedupe every link list: exam_classes/exam_subjects/exam_topics have
          // no unique constraint on (exam_id, *_id), and the save path's
          // delete-then-insert has left duplicate rows on real drafts (one was
          // found with the same class linked twice). Duplicates make the class
          // picker's group resolution ambiguous and inflate selection counts.
          classIds: uniqueIds(
            ((row.exam_classes as RawLinkRow[]) || []).map((ec) => ec.class_id),
          ),
          subjectIds: uniqueIds(
            ((row.exam_subjects as RawLinkRow[]) || []).map((es) => es.subject_id),
          ),
          // chapterIds = syllabus_topics rows from exam_topics (same as topicIds)
          chapterIds: uniqueIds(
            ((row.exam_topics as RawLinkRow[]) || []).map((et) => et.topic_id),
          ),
          topicIds: uniqueIds(
            ((row.exam_topics as RawLinkRow[]) || []).map((et) => et.topic_id),
          ),
          customTopicIds: uniqueIds(
            ((row.exam_topics as RawLinkRow[]) || []).map((et) => et.custom_topic_id),
          ),
        },
        metadata: {
          title: (row.title as string) || "",
          description: (row.description as string) || "",
          examMode: (row.exam_mode as ExamMode) || "offline",
          examType: ((row.exam_type as ExamType) || "unspecified"),
          scheduledDate: row.scheduled_date
            ? new Date(row.scheduled_date as string)
            : null,
          startTime: row.start_time
            ? new Date(row.start_time as string).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
          endTime: row.end_time
            ? new Date(row.end_time as string).toLocaleTimeString("en-US", {
                hour12: false,
                hour: "2-digit",
                minute: "2-digit",
              })
            : "",
          durationMinutes: (row.duration_minutes as number) || 60,
          passMarks: (row.pass_marks as number) ?? null,
          instructions: (row.instructions as string) || "",
          ocrConfidenceThreshold:
            (row.ocr_confidence_threshold as number) || 0.7,
          availabilityStart: row.availability_start
            ? new Date(row.availability_start as string)
            : null,
          availabilityEnd: row.availability_end
            ? new Date(row.availability_end as string)
            : null,
          // Load the stored late-entry window back — without this, editing an
          // exam silently reset it to the default on the next save.
          lateEntryMinutes:
            row.late_entry_minutes === null || row.late_entry_minutes === undefined
              ? undefined
              : Number(row.late_entry_minutes),
          // Must normalize, not cast: legacy rows store snake_case keys, so a
          // raw cast left tabSwitchLock/fullscreenLock/copyPasteDisable
          // undefined, which renders the Switches as uncontrolled and wrote
          // those keys back out as missing on the next save.
          proctoringConfig: normalizeProctoringConfig(row.proctoring_config),
          resultVisibility:
            ((row.result_visibility as string) as ResultVisibility) ||
            "after_teacher_releases",
          visibleToStudents: (row.visible_to_students as boolean) ?? false,
          hybridSettings: mapHybridSettings(row.hybrid_exam_settings),
          templateId: (row.template_id as string) ?? null,
          isResultsOnly: (row.is_results_only as boolean) ?? false,
          sourcePaperFiles:
            (row.source_paper_files as SourcePaperFile[] | null) ?? [],
          totalMarksOverride: (row.total_marks as number) ?? null,
        },
        sections,
        blueprints: [],
      };
    },
  });
}

interface ExamCreationFlowProps {
  mode?: "create" | "edit";
  examId?: string;
}

type Screen = "details" | "questions" | "review" | "resultsMarks";

/**
 * Where to drop a teacher when they hit "Continue" on a draft — the furthest
 * step their saved work justifies, instead of always restarting at Details.
 * Conservative on purpose: it only skips a step whose inputs are actually
 * present, so an incomplete draft still lands where the work is missing.
 */
function resumeScreenFor(data: ExamFormData): Screen {
  if (data.metadata.isResultsOnly) return "resultsMarks";

  const detailsDone =
    !!data.metadata.title &&
    data.context.classIds.length > 0 &&
    data.context.subjectIds.length > 0 &&
    data.sections.length > 0;
  if (!detailsDone) return "details";

  // Every section carries at least one question → the paper is authored, so the
  // teacher's next real decision is scheduling/publishing on Review.
  const everySectionFilled = data.sections.every(
    (s) => (s.questions?.length ?? 0) > 0
  );
  return everySectionFilled ? "review" : "questions";
}

/**
 * Top-level mobile-first exam creation orchestrator. Replaces the legacy
 * ExamWizard — drives TemplatePicker → Details → Questions → Review/Publish
 * as an in-memory state machine backed by useExamForm + useSaveExam.
 */
export function ExamCreationFlow({
  mode = "create",
  examId,
}: ExamCreationFlowProps) {
  const navigate = useNavigate();
  const { institutionId, isLoading: instLoading } = useEffectiveInstitution();
  const form = useExamForm();
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const saveExam = useSaveExam({ isCallerMounted: () => mountedRef.current });
  const queryClient = useQueryClient();
  // Live single-flight: a render's saveExam.isPending is stale inside a
  // closure that resumes later (the schedule sheet's pre-publish recheck).
  const isSaving = () => queryClient.isMutating({ mutationKey: SAVE_EXAM_MUTATION_KEY }) > 0;

  // Edit mode: load the existing exam via direct Supabase query
  const { data: loadedExam, isLoading: loadingExam } = useExamFormLoader(
    mode === "edit" ? examId : undefined
  );

  const lockStatusQuery = useExamLockStatus(
    mode === "edit" ? examId : undefined
  );
  const { mutate: bumpVersion } = useBumpExamVersion();

  const [screen, setScreen] = useState<Screen>("details");
  const [templateOpen, setTemplateOpen] = useState(mode === "create");
  const [versionWarningOpen, setVersionWarningOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [resultSetupOpen, setResultSetupOpen] = useState(false);
  // Section the Questions screen should open on. Set by the Review step's
  // per-section "Edit" links; null means "first section", as before.
  const [focusSectionTempId, setFocusSectionTempId] = useState<string | null>(null);

  // Seed institution context on first load. `useEffectiveInstitution` resolves
  // this from the user's role (teacher/admin) or the super-admin managed
  // institution context, so every non-super-admin user gets their own
  // institution_id automatically — no manual selection needed.
  useEffect(() => {
    if (institutionId && !form.formData.context.institutionId) {
      form.updateContext({ institutionId });
    }
  }, [institutionId, form]);

  // Hydrate edit-mode form from the loaded exam
  useEffect(() => {
    if (
      mode === "edit" &&
      loadedExam &&
      !hydrated &&
      institutionId
    ) {
      form.loadForm(loadedExam);
      setHydrated(true);
      setTemplateOpen(false);
      setScreen(resumeScreenFor(loadedExam));
    }
  }, [mode, loadedExam, hydrated, institutionId, form]);

  // Edit mode: show version warning if the exam is locked
  useEffect(() => {
    if (
      mode === "edit" &&
      hydrated &&
      lockStatusQuery.data?.isLockedForEdits &&
      lockStatusQuery.data?.hasAttempts
    ) {
      setVersionWarningOpen(true);
    }
  }, [mode, hydrated, lockStatusQuery.data]);

  // Which header steps the teacher may click straight to. Mirrors
  // resumeScreenFor's rules so the indicator can never land someone on a screen
  // with nothing to work on: Questions needs the details filled in, Review needs
  // every section actually populated.
  const reachableSteps = useMemo<ExamWizardStep[]>(() => {
    const d = form.formData;
    const steps: ExamWizardStep[] = ["details"];
    const detailsDone =
      !!d.metadata.title &&
      d.context.classIds.length > 0 &&
      d.context.subjectIds.length > 0 &&
      d.sections.length > 0;
    if (!detailsDone) return steps;
    steps.push("questions");
    if (d.sections.every((s) => (s.questions?.length ?? 0) > 0)) {
      steps.push("review");
    }
    return steps;
  }, [form.formData]);

  const handleStartFromScratch = () => {
    setTemplateOpen(false);
  };

  const handleUseTemplate = (template: ExamTemplate) => {
    const data = template.templateData;

    // Detect new lean blueprint format (has `examMode` at top level, no `context`)
    const isBlueprint = "examMode" in data && !("context" in data);

    if (isBlueprint) {
      const bp = data as TemplateBlueprint;
      // Apply only structural sections — keep existing context & metadata
      form.updateMetadata({ examMode: bp.examMode, templateId: template.id });
      // Replace sections with blueprint sections (empty questions)
      const tempSections: ExamSection[] = bp.sections.map((s, i) => ({
        tempId: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        title: s.title,
        sectionType: s.sectionType,
        sectionOrder: i + 1,
        allowedQuestionTypes: s.allowedQuestionTypes,
        questionTypeCounts: s.questionTypeCounts,
        questionTypeMarks: s.questionTypeMarks,
        defaultMarks: s.defaultMarks,
        negativeMarking: s.negativeMarking,
        description: "",
        instructions: s.instructions || "",
        expectedQuestionCount: Object.values(s.questionTypeCounts).reduce((a, b) => a + b, 0),
        questions: [],
      }));
      form.loadForm({
        ...form.formData,
        sections: tempSections,
        metadata: { ...form.formData.metadata, examMode: bp.examMode, templateId: template.id },
      });
    } else {
      // Legacy: full ExamFormData — still strip questions & context
      const legacy = data as ExamFormData;
      const tempSections: ExamSection[] = legacy.sections.map((s, i) => ({
        ...s,
        tempId: `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        sectionOrder: i + 1,
        questions: [],
      }));
      form.loadForm({
        ...form.formData,
        sections: tempSections,
        metadata: { ...form.formData.metadata, examMode: legacy.metadata.examMode, templateId: template.id },
      });
    }

    setTemplateOpen(false);
    toast.success(`Loaded template: ${template.name}`);
  };

  const handleConfirmVersionBump = () => {
    if (!examId) return;
    bumpVersion(examId, {
      onSuccess: () => setVersionWarningOpen(false),
    });
  };

  const handleCancelVersionBump = () => {
    setVersionWarningOpen(false);
    navigate("/exams");
  };

  const handleSaveDraft = () => {
    if (isSaving()) {
      // The soft-save fired on entering Review may still be in flight.
      toast.info("Still saving, one moment.");
      return;
    }
    saveExam.mutate(
      { formData: form.formData, publish: false, onDraftCreated: form.setExamId },
      {
        onSuccess: (result) => {
          form.setExamId(result.examId);
          toast.success("Draft saved");
        },
        onError: (err: Error) => {
          toastError(err, { fallback: "Couldn't save the draft.", context: "saveExamDraft" });
        },
      }
    );
  };

  const handleEditSection = (sectionTempId: string) => {
    setFocusSectionTempId(sectionTempId);
    setScreen("questions");
  };

  // Every other route into a screen clears the focus, so a "Fix" click is
  // one-shot: the next plain Back/Continue lands on Section A as before.
  const goTo = (next: Screen) => {
    setFocusSectionTempId(null);
    setScreen(next);
  };

  // One mutation serves both buttons, so tell them apart by the variables of
  // the call in flight; otherwise "Save draft" would show "Publishing…".
  const isPublishing = saveExam.isPending && saveExam.variables?.publish === true;
  const isSavingDraft = saveExam.isPending && saveExam.variables?.publish === false;

  // A publish the server refused for a slot clash: shown inside the schedule
  // sheet (ReviewPublishScreen), which stays open, so no toast on top of it.
  const publishError = saveExam.variables?.publish === true ? saveExam.error : null;

  const handlePublish = () => {
    // Single-flight: the schedule sheet's confirm button can be tapped twice
    // before it unmounts, and two publishes would create two exams.
    if (isSaving()) {
      toast.info("Still saving, one moment.");
      return;
    }
    saveExam.mutate(
      // onDraftCreated: if the draft had never been saved (the soft-save on
      // entering Review failed), a refused publish must not leave its id
      // behind, or every retry inserts another orphan draft.
      { formData: form.formData, publish: true, onDraftCreated: form.setExamId },
      {
        onSuccess: () => {
          toast.success("Exam published", {
            description: "The exam is now available to students",
          });
          // There is no /exams/:examId detail route — send the user back to
          // the My Exams list where the newly-published exam will appear.
          navigate("/exams");
        },
        onError: (err: Error) => {
          if (isExamSlotConflictError(err)) {
            void queryClient.invalidateQueries({ queryKey: ["exam-slot-bookings"] });
            return;
          }
          toastError(err, { fallback: "Couldn't publish the exam.", context: "publishExam" });
        },
      }
    );
  };

  // Autosave draft on meaningful transitions
  const handleContinueFromDetails = () => {
    if (form.formData.metadata.isResultsOnly) {
      setResultSetupOpen(true);
    } else {
      goTo("questions");
    }
  };

  const handleContinueFromQuestions = () => {
    // A soft-save already in flight will finish on its own; a second one
    // started before it has returned the new id would insert a second draft.
    if (isSaving()) {
      setScreen("review");
      return;
    }
    // Soft-save draft before entering review
    saveExam.mutate(
      { formData: form.formData, publish: false, onDraftCreated: form.setExamId },
      {
        onSuccess: (result) => {
          form.setExamId(result.examId);
        },
        // Silent before: a failed soft-save left Review with no draft and no
        // explanation until the next explicit save failed too.
        onError: (err: Error) => {
          toastError(err, { fallback: "Couldn't save the draft.", context: "autosaveExamDraft" });
        },
      }
    );
    setScreen("review");
  };

  const handleConfirmResultSetup = (values: ResultSetupValues) => {
    const total = values.totalMarks;
    const syntheticSection: ExamSection = {
      tempId: `temp_${Date.now()}_total`,
      title: "Total",
      description: "",
      instructions: "",
      sectionOrder: 1,
      defaultMarks: total,
      negativeMarking: 0,
      questions: [],
      totalMarks: total,
      chapterIds: [...form.formData.context.chapterIds],
    };
    const nextForm: ExamFormData = {
      ...form.formData,
      sections: [syntheticSection],
      metadata: {
        ...form.formData.metadata,
        isResultsOnly: true,
        scheduledDate: values.scheduledDate,
        totalMarksOverride: total,
        // useSaveExam treats passMarks as a percentage.
        passMarks: values.passPercent,
        resultVisibility: values.resultVisibility,
      },
    };
    form.loadForm(nextForm);
    saveExam.mutate(
      { formData: nextForm, publish: true, onDraftCreated: form.setExamId },
      {
        onSuccess: (result) => {
          form.setExamId(result.examId);
          setResultSetupOpen(false);
          setScreen("resultsMarks");
          toast.success("Exam saved", { description: "Now enter each student's marks." });
        },
        onError: (err: Error) =>
          toastError(err, {
            fallback: "Couldn't save the exam.",
            context: "saveResultsOnlyExam",
          }),
      },
    );
  };

  if (instLoading || (mode === "edit" && loadingExam)) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      {screen === "details" && (
        <ExamDetailsScreen
          reachableSteps={reachableSteps}
          onNavigateStep={goTo}
          formData={form.formData}
          updateMetadata={form.updateMetadata}
          updateContext={form.updateContext}
          addSection={form.addSection}
          updateSection={form.updateSection}
          removeSection={form.removeSection}
          onContinue={handleContinueFromDetails}
        />
      )}

      {screen === "questions" && (
        <QuestionsScreen
          reachableSteps={reachableSteps}
          onNavigateStep={goTo}
          formData={form.formData}
          isComplete={form.isComplete}
          addQuestion={form.addQuestion}
          updateQuestion={form.updateQuestion}
          removeQuestion={form.removeQuestion}
          onBack={() => goTo("details")}
          onContinue={handleContinueFromQuestions}
          initialSectionTempId={focusSectionTempId}
        />
      )}

      {screen === "review" && (
        <ReviewPublishScreen
          reachableSteps={reachableSteps}
          onNavigateStep={goTo}
          formData={form.formData}
          stats={form.stats}
          updateMetadata={form.updateMetadata}
          onBack={() => goTo("questions")}
          onPublish={handlePublish}
          isPublishing={isPublishing}
          publishError={publishError}
          onSaveDraft={handleSaveDraft}
          isSavingDraft={isSavingDraft}
          onEditSection={handleEditSection}
        />
      )}

      {screen === "resultsMarks" && form.formData.examId && (
        <OfflineMarksEntryScreen examId={form.formData.examId} />
      )}

      <TemplatePickerSheet
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        onStartFromScratch={handleStartFromScratch}
        onUseTemplate={handleUseTemplate}
      />

      <ResultSetupSheet
        open={resultSetupOpen}
        onOpenChange={setResultSetupOpen}
        isSaving={saveExam.isPending}
        onConfirm={handleConfirmResultSetup}
      />

      <VersionWarningModal
        open={versionWarningOpen}
        currentVersion={lockStatusQuery.data?.currentVersion ?? 1}
        onConfirm={handleConfirmVersionBump}
        onCancel={handleCancelVersionBump}
      />
    </>
  );
}
