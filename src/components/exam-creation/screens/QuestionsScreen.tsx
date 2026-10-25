import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  CheckCircle2,
  ArrowLeft,
  BookOpen,
  AlertCircle,
  Image as ImageIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AnimatedContainer } from "@/components/ui/animated-container";
import { MathText } from "@/components/ui/math-text";
import { useClassSubjects } from "@/hooks/useClassSubjects";
import { useTeacherAssignedSubjects } from "@/hooks/useTeacherAssignedSubjects";
import { useUserRole } from "@/hooks/useUserRole";
import { useExamClassHierarchy } from "@/hooks/useExamClassHierarchy";
import { useChaptersForExam } from "@/hooks/useChaptersForExam";
import { StickyBottomCTA } from "../components/StickyBottomCTA";
import { ExamStepIndicator, type ExamWizardStep } from "../components/ExamStepIndicator";
import { CompletionBar } from "../components/CompletionBar";
import { TypeGroupPill } from "../components/TypeGroupPill";
import {
  SectionTabStrip,
  type SectionTab,
} from "../components/SectionTabStrip";
import { LABEL_MAP } from "../components/QuestionTypeChip";
import { MethodPickerSheet, type AddMethod } from "./MethodPickerSheet";
import { AIGenerateSheet } from "./AIGenerateSheet";
import { QuestionBankSheet } from "./QuestionBankSheet";
import { ManualEntrySheet } from "./ManualEntrySheet";
import type {
  ExamFormData,
  ExamQuestion,
  ExamSection,
  QuestionType,
  SectionType,
} from "@/types/exam";

interface QuestionsScreenProps {
  /** Steps the teacher may jump to from the header indicator. */
  reachableSteps?: ExamWizardStep[];
  onNavigateStep?: (step: ExamWizardStep) => void;
  formData: ExamFormData;
  isComplete: boolean;
  addQuestion: (
    sectionTempId: string,
    question: Omit<ExamQuestion, "tempId">
  ) => void;
  updateQuestion: (
    sectionTempId: string,
    questionTempId: string,
    updates: Partial<ExamQuestion>
  ) => void;
  removeQuestion: (sectionTempId: string, questionTempId: string) => void;
  onBack: () => void;
  onContinue: () => void;
  /**
   * Section to open on first render. The Review step's "Edit" links pass the
   * section they were pointing at, so the teacher lands on it instead of on
   * Section A every time.
   */
  initialSectionTempId?: string | null;
}

type PickerContext = {
  sectionTempId: string;
  questionType: QuestionType;
};

/**
 * Per-section completion snapshot computed fresh each render. Mirrors
 * useExamForm.completionStats but lives here so the screen can cheaply
 * read per-type `remainingSlots` as it dispatches to each add-method sheet.
 */
type SectionCompletion = {
  totalTarget: number;
  totalActual: number;
  percent: number;
  byType: Record<string, { target: number; actual: number }>;
};

function computeSectionCompletion(section: ExamSection): SectionCompletion {
  const counts = section.questionTypeCounts || {};
  const actualByType = section.questions.reduce<Record<string, number>>(
    (acc, q) => {
      const key = String(q.questionType);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    },
    {}
  );

  const typeKeys = new Set<string>([
    ...Object.keys(counts),
    ...Object.keys(actualByType),
  ]);

  const byType: SectionCompletion["byType"] = {};
  let totalTarget = 0;
  let totalActual = 0;
  typeKeys.forEach((t) => {
    const target = counts[t] ?? 0;
    const actual = actualByType[t] ?? 0;
    byType[t] = { target, actual };
    totalTarget += target;
    totalActual += actual;
  });

  const percent =
    totalTarget > 0
      ? Math.min(100, Math.round((totalActual / totalTarget) * 100))
      : 0;

  return { totalTarget, totalActual, percent, byType };
}

function labelForType(type: string): string {
  // Case study / comprehension sections track *parent* questions at the
  // section level (one parent = one passage / case study). The spec asks
  // for a "Sub-questions" phrasing for these - we keep the item count
  // consistent with the data model and use a friendlier noun instead of
  // the generic "Questions" label.
  if (type === "case_study") return "Case studies";
  if (type === "comprehension") return "Passages";
  return LABEL_MAP[type as SectionType] ?? type;
}

function itemNounForType(type: string, count: number): string {
  if (type === "case_study") return count === 1 ? "case study" : "case studies";
  if (type === "comprehension") return count === 1 ? "passage" : "passages";
  return count === 1 ? "question" : "questions";
}

export function QuestionsScreen({
  reachableSteps,
  onNavigateStep,
  formData,
  isComplete,
  addQuestion,
  updateQuestion,
  removeQuestion,
  onBack,
  onContinue,
  initialSectionTempId = null,
}: QuestionsScreenProps) {
  const classId = formData.context.classIds[0] ?? "";
  const subjectId = formData.context.subjectIds[0] ?? "";
  const institutionId = formData.context.institutionId ?? "";

  // -- Name resolution for child sheets ---------------------------------
  const { data: roleInfo } = useUserRole();
  const isTeacher = !!roleInfo?.isTeacher;
  const { classGroups } = useExamClassHierarchy(institutionId);
  const { data: classSubjects } = useClassSubjects(classId, institutionId);
  const { data: teacherAssignments } = useTeacherAssignedSubjects();

  const className = useMemo(() => {
    for (const g of classGroups) {
      const match = g.sections.find((s) => s.id === classId);
      if (match) return match.displayName;
    }
    return undefined;
  }, [classGroups, classId]);

  const subjectName = useMemo(() => {
    if (isTeacher) {
      const match = teacherAssignments?.flat.find(
        (a) => a.subjectId === subjectId && a.classId === classId
      );
      return match?.subjectName ?? undefined;
    }
    return classSubjects?.all.find((s) => s.id === subjectId)?.name;
  }, [isTeacher, teacherAssignments, classSubjects, subjectId, classId]);

  // -- Chapter names for display ----------------------------------------
  const { data: chapters } = useChaptersForExam({ classId, subjectId });
  const chapterNameById = useMemo(() => {
    const m = new Map<string, string>();
    (chapters || []).forEach((c) => {
      m.set(
        c.id,
        c.chapterNumber != null
          ? `Ch ${c.chapterNumber}. ${c.topicName}`
          : c.topicName
      );
    });
    return m;
  }, [chapters]);

  // -- Active section (tab state) ---------------------------------------
  const [activeSectionTempId, setActiveSectionTempId] = useState<string | null>(
    () =>
      (initialSectionTempId &&
      formData.sections.some((s) => s.tempId === initialSectionTempId)
        ? initialSectionTempId
        : null) ??
      formData.sections[0]?.tempId ??
      null
  );
  // Keep the active tab in sync if sections change (add/remove)
  useEffect(() => {
    if (formData.sections.length === 0) {
      setActiveSectionTempId(null);
      return;
    }
    if (
      !activeSectionTempId ||
      !formData.sections.some((s) => s.tempId === activeSectionTempId)
    ) {
      setActiveSectionTempId(formData.sections[0].tempId);
    }
  }, [formData.sections, activeSectionTempId]);

  const activeSection =
    formData.sections.find((s) => s.tempId === activeSectionTempId) ?? null;

  // -- Method picker / sheet state --------------------------------------
  const [pickerCtx, setPickerCtx] = useState<PickerContext | null>(null);
  const [activeMethod, setActiveMethod] = useState<AddMethod | null>(null);
  const [editingQuestion, setEditingQuestion] = useState<ExamQuestion | null>(
    null
  );

  const pickerSection = useMemo(
    () =>
      pickerCtx
        ? formData.sections.find((s) => s.tempId === pickerCtx.sectionTempId) ??
          null
        : null,
    [formData.sections, pickerCtx]
  );

  // Live remaining slots for the (section, type) in the picker - recomputed
  // every render so each sheet always sees the up-to-date value after an
  // accept/add inside the same session.
  const pickerRemaining = useMemo(() => {
    if (!pickerCtx || !pickerSection) return 0;
    const completion = computeSectionCompletion(pickerSection);
    const row = completion.byType[pickerCtx.questionType];
    if (!row) return 0;
    return Math.max(0, row.target - row.actual);
  }, [pickerCtx, pickerSection]);

  const openMethodPicker = (sectionTempId: string, type: QuestionType) => {
    setEditingQuestion(null);
    setPickerCtx({ sectionTempId, questionType: type });
    setActiveMethod(null);
  };

  const handlePickMethod = (method: AddMethod) => {
    setActiveMethod(method);
  };

  const closeAllSheets = () => {
    setPickerCtx(null);
    setActiveMethod(null);
    setEditingQuestion(null);
  };

  // Editing: skip the method picker and go straight to ManualEntrySheet
  const openEditQuestion = (section: ExamSection, q: ExamQuestion) => {
    setPickerCtx({
      sectionTempId: section.tempId,
      questionType: q.questionType,
    });
    setEditingQuestion(q);
    setActiveMethod("manual");
  };

  // -- Per-section tabs / active completion -----------------------------
  const tabs: SectionTab[] = formData.sections.map((s, i) => {
    const c = computeSectionCompletion(s);
    return {
      tempId: s.tempId,
      label: String.fromCharCode(65 + i),
      title: s.title,
      actual: c.totalActual,
      target: c.totalTarget,
    };
  });

  const activeCompletion = activeSection
    ? computeSectionCompletion(activeSection)
    : null;

  // -- Guards / empty states --------------------------------------------
  if (formData.sections.length === 0) {
    return (
      <AnimatedContainer className="mx-auto max-w-4xl p-4 md:p-8">
        <EmptyState
          title="No sections yet"
          body="Go back to Details and add at least one section before adding questions."
          onBack={onBack}
        />
      </AnimatedContainer>
    );
  }

  return (
    <AnimatedContainer className="mx-auto max-w-4xl pb-28">
      {/* Header */}
      <header className="px-4 pt-4 pb-1 md:px-8 md:pt-8">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onBack}
              className="h-9 w-9 flex-shrink-0"
              aria-label="Back to details"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl font-bold text-foreground md:text-2xl truncate">
                Add questions
              </h1>
              <p className="text-xs text-muted-foreground md:text-sm">
                Fill every section before continuing.
              </p>
            </div>
          </div>
          {/* Desktop step indicator */}
          <ExamStepIndicator
            className="flex-shrink-0"
            current="questions"
            reachable={reachableSteps ?? []}
            onNavigate={onNavigateStep ?? (() => {})}
          />
        </div>
      </header>

      {/* Section tabs */}
      <SectionTabStrip
        tabs={tabs}
        activeTempId={activeSectionTempId}
        onSelect={setActiveSectionTempId}
      />

      {/* Active section body */}
      {activeSection && activeCompletion && (
        <div className="px-4 md:px-8 space-y-4">
          <SectionSummaryCard
            section={activeSection}
            completion={activeCompletion}
            chapterNameById={chapterNameById}
          />

          <TypeGroups
            section={activeSection}
            completion={activeCompletion}
            onAdd={(type) => openMethodPicker(activeSection.tempId, type)}
            onEdit={(q) => openEditQuestion(activeSection, q)}
            onRemove={(q) => removeQuestion(activeSection.tempId, q.tempId)}
          />
        </div>
      )}

      {/* Continue CTA */}
      <StickyBottomCTA
        label="Continue to review"
        disabled={!isComplete}
        helperText={
          !isComplete
            ? "All sections must be complete before proceeding."
            : undefined
        }
        onClick={onContinue}
      />

      {/* -- Method picker + per-method sheets -- */}
      <MethodPickerSheet
        open={pickerCtx !== null && activeMethod === null}
        onOpenChange={(open) => {
          if (!open) setPickerCtx(null);
        }}
        sectionTitle={pickerSection?.title ?? ""}
        typeLabel={
          pickerCtx ? labelForType(pickerCtx.questionType) : ""
        }
        remaining={pickerRemaining}
        onPick={handlePickMethod}
      />

      <AIGenerateSheet
        open={activeMethod === "ai"}
        onOpenChange={(open) => {
          if (!open) closeAllSheets();
        }}
        section={pickerSection}
        questionType={pickerCtx?.questionType ?? null}
        remaining={pickerRemaining}
        classId={classId}
        subjectId={subjectId}
        subjectName={subjectName}
        institutionId={institutionId}
        onAddQuestion={addQuestion}
      />

      <QuestionBankSheet
        open={activeMethod === "bank"}
        onOpenChange={(open) => {
          if (!open) closeAllSheets();
        }}
        section={pickerSection}
        questionType={pickerCtx?.questionType ?? null}
        remaining={pickerRemaining}
        institutionId={institutionId}
        classId={classId}
        className={className}
        subjectId={subjectId}
        subjectName={subjectName}
        onAddQuestion={addQuestion}
      />

      <ManualEntrySheet
        open={activeMethod === "manual"}
        onOpenChange={(open) => {
          if (!open) closeAllSheets();
        }}
        section={pickerSection}
        questionType={pickerCtx?.questionType ?? null}
        remaining={pickerRemaining}
        onAddQuestion={(sectionTempId, q) => {
          // ManualEntrySheet passes the full ExamQuestion (incl. tempId),
          // but addQuestion expects Omit<ExamQuestion, "tempId"> and
          // generates its own. Strip the tempId so the form-authored
          // placeholder doesn't leak into section state.
          const { tempId: _drop, ...rest } = q;
          addQuestion(sectionTempId, rest);
        }}
        editingQuestion={editingQuestion}
        onUpdateQuestion={updateQuestion}
      />
    </AnimatedContainer>
  );
}

/* --------------------------------------------------------------------
   Section summary card - "Section A | 7 / 10 added | Chapter: ..."
   -------------------------------------------------------------------- */
interface SectionSummaryCardProps {
  section: ExamSection;
  completion: SectionCompletion;
  chapterNameById: Map<string, string>;
}

function SectionSummaryCard({
  section,
  completion,
  chapterNameById,
}: SectionSummaryCardProps) {
  const chapterIds = section.chapterIds ?? [];
  const chapterNames = chapterIds
    .map((id) => chapterNameById.get(id))
    .filter((x): x is string => !!x);

  const { totalTarget, totalActual, percent } = completion;
  const isFull = totalTarget > 0 && totalActual >= totalTarget;
  const isEmpty = totalActual === 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Section
          </div>
          <h2 className="text-lg font-bold text-foreground truncate md:text-xl">
            {section.title || "Untitled section"}
          </h2>
        </div>
        <ProgressBadge
          actual={totalActual}
          target={totalTarget}
          isFull={isFull}
          isEmpty={isEmpty}
        />
      </div>

      <CompletionBar percent={percent} />

      {chapterNames.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <BookOpen className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
          <span className="flex-1">
            <span className="font-medium text-foreground">
              Chapter{chapterNames.length > 1 ? "s" : ""}:
            </span>{" "}
            {chapterNames.join(", ")}
          </span>
        </div>
      )}
    </section>
  );
}

function ProgressBadge({
  actual,
  target,
  isFull,
  isEmpty,
}: {
  actual: number;
  target: number;
  isFull: boolean;
  isEmpty: boolean;
}) {
  const cls = isFull
    ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/40 dark:text-emerald-200 dark:border-emerald-700"
    : isEmpty
    ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-900/40 dark:text-red-200 dark:border-red-800"
    : "bg-[#fa920e]/15 text-[#b45309] border-[#fa920e]/40 dark:bg-[#fa920e]/20 dark:text-[#fed7aa] dark:border-[#fa920e]/50";

  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-full px-3 py-1 text-xs font-semibold border whitespace-nowrap",
        cls
      )}
    >
      {isFull && <CheckCircle2 className="h-3.5 w-3.5 mr-1 inline-block" />}
      {actual} / {target} added
    </Badge>
  );
}

/* --------------------------------------------------------------------
   Per-type group rows with Add button + existing questions list
   -------------------------------------------------------------------- */
interface TypeGroupsProps {
  section: ExamSection;
  completion: SectionCompletion;
  onAdd: (type: QuestionType) => void;
  onEdit: (q: ExamQuestion) => void;
  onRemove: (q: ExamQuestion) => void;
}

function TypeGroups({
  section,
  completion,
  onAdd,
  onEdit,
  onRemove,
}: TypeGroupsProps) {
  const allowed = section.allowedQuestionTypes ?? [];

  if (allowed.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
        <AlertCircle className="h-5 w-5 text-muted-foreground mx-auto mb-2" />
        This section has no question types configured yet. Go back to Details
        to add some.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {allowed.map((type) => {
        const row = completion.byType[type] ?? { target: 0, actual: 0 };
        const marks = section.questionTypeMarks?.[type] ?? 1;
        const questions = section.questions.filter(
          (q) => q.questionType === type
        );
        const remaining = Math.max(0, row.target - row.actual);
        const isFull = row.target > 0 && row.actual >= row.target;

        return (
          <TypeGroupCard
            key={type}
            type={type}
            target={row.target}
            actual={row.actual}
            marks={marks}
            remaining={remaining}
            isFull={isFull}
            questions={questions}
            onAdd={() => onAdd(type as QuestionType)}
            onEdit={onEdit}
            onRemove={onRemove}
          />
        );
      })}
    </div>
  );
}

interface TypeGroupCardProps {
  type: string;
  target: number;
  actual: number;
  marks: number;
  remaining: number;
  isFull: boolean;
  questions: ExamQuestion[];
  onAdd: () => void;
  onEdit: (q: ExamQuestion) => void;
  onRemove: (q: ExamQuestion) => void;
}

function TypeGroupCard({
  type,
  target,
  actual,
  marks,
  remaining,
  isFull,
  questions,
  onAdd,
  onEdit,
  onRemove,
}: TypeGroupCardProps) {
  const label = labelForType(type);
  const noun = itemNounForType(type, target);
  const percent =
    target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-muted/20">
        <TypeGroupPill type={type} count={target} marksPerQuestion={marks} />
        <div className="min-w-0 flex-1">
          <div className="text-xs text-muted-foreground">
            {label}: <span className="font-semibold text-foreground">{actual} / {target}</span> {noun}
          </div>
          <CompletionBar percent={percent} className="mt-1.5 h-1.5" />
        </div>
        <Button
          type="button"
          size="sm"
          variant={isFull ? "ghost" : "default"}
          className={cn(
            "min-h-[40px] gap-1.5 flex-shrink-0",
            isFull && "text-emerald-600 hover:text-emerald-700"
          )}
          onClick={onAdd}
          disabled={isFull}
          aria-label={isFull ? `${label} section full` : `Add ${label}`}
        >
          {isFull ? (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Full
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Add ({remaining})
            </>
          )}
        </Button>
      </div>

      {/* Questions list */}
      {questions.length > 0 ? (
        <ul className="divide-y divide-border">
          {questions.map((q, i) => (
            <li
              key={q.tempId}
              className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                {q.questionText ? (
                  <MathText
                    as="div"
                    className="text-sm text-foreground line-clamp-2"
                    text={q.questionText}
                  />
                ) : (
                  <div className="text-sm text-foreground line-clamp-2">
                    <span className="italic text-muted-foreground">
                      (no question text)
                    </span>
                  </div>
                )}
                <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{q.marks} marks</span>
                  {q.subQuestions && q.subQuestions.length > 0 && (
                    <>
                      <span className="text-border">·</span>
                      <span>{q.subQuestions.length} sub-questions</span>
                    </>
                  )}
                  {q.imageUrl && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
                      <ImageIcon className="h-3 w-3" />
                      Diagram
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => onEdit(q)}
                  aria-label="Edit question"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => onRemove(q)}
                  aria-label="Remove question"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          No {noun} added yet. Tap <strong>Add</strong> to start.
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------------
   Empty state for "no sections configured"
   -------------------------------------------------------------------- */
function EmptyState({
  title,
  body,
  onBack,
}: {
  title: string;
  body: string;
  onBack: () => void;
}) {
  return (
    <div className="mx-auto max-w-md rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center">
      <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground mt-1">{body}</p>
      <Button
        type="button"
        variant="outline"
        className="mt-4 gap-1.5"
        onClick={onBack}
      >
        <ArrowLeft className="h-4 w-4" />
        Back to details
      </Button>
    </div>
  );
}
