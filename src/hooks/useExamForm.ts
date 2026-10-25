import { useState, useCallback, useMemo } from "react";
import type {
  ExamFormData,
  ExamSection,
  ExamQuestion,
  EvaluationBlueprint,
  WizardStep,
  ExamStats,
  ValidationError,
} from "@/types/exam";
import { DEFAULT_PROCTORING_CONFIG } from "@/types/exam";
import { DEFAULT_LATE_ENTRY_MINUTES } from "@/lib/examSchedule";

const generateTempId = () => `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

const initialFormData: ExamFormData = {
  examId: undefined, // No exam yet - will be set after first save
  context: {
    institutionId: "",
    classIds: [],
    subjectIds: [],
    chapterIds: [],
    topicIds: [],
    customTopicIds: [],
  },
  metadata: {
    title: "",
    description: "",
    examMode: "offline",
    examType: "unit",
    scheduledDate: null,
    startTime: "",
    endTime: "",
    durationMinutes: 60,
    passMarks: null,
    instructions: "",
    ocrConfidenceThreshold: 0.7,
    // Must match what the publish sheet renders. Leaving it undefined made the
    // sheet show 15 while the save wrote 0, collapsing the join window onto the
    // start time so every student saw the exam as already expired.
    lateEntryMinutes: DEFAULT_LATE_ENTRY_MINUTES,
    availabilityStart: null,
    availabilityEnd: null,
    proctoringConfig: { ...DEFAULT_PROCTORING_CONFIG },
    resultVisibility: "after_teacher_releases",
    visibleToStudents: false,
    hybridSettings: undefined,
    templateId: null,
  },
  sections: [],
  blueprints: [],
};

export function useExamForm() {
  const [formData, setFormData] = useState<ExamFormData>(initialFormData);
  const [currentStep, setCurrentStep] = useState<WizardStep>("details");
  const [isDirty, setIsDirty] = useState(false);

  // Set exam ID after first save (used to prevent duplicate drafts)
  const setExamId = useCallback((examId: string) => {
    setFormData(prev => ({
      ...prev,
      examId,
    }));
  }, []);

  // Update context
  const updateContext = useCallback((context: Partial<ExamFormData["context"]>) => {
    setFormData(prev => ({
      ...prev,
      context: { ...prev.context, ...context },
    }));
    setIsDirty(true);
  }, []);

  // Update metadata
  const updateMetadata = useCallback((metadata: Partial<ExamFormData["metadata"]>) => {
    setFormData(prev => ({
      ...prev,
      metadata: { ...prev.metadata, ...metadata },
    }));
    setIsDirty(true);
  }, []);

  // Section operations
  const addSection = useCallback((section: Omit<ExamSection, "tempId" | "sectionOrder">) => {
    setFormData(prev => ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          ...section,
          tempId: generateTempId(),
          sectionOrder: prev.sections.length + 1,
          sectionType: section.sectionType || "mcq",
          defaultMarks: section.defaultMarks || 1,
          // Default MCQ negative marking = 0 (rule #9)
          negativeMarking: section.negativeMarking ?? 0,
          questions: section.questions || [],
        },
      ],
    }));
    setIsDirty(true);
  }, []);

  const updateSection = useCallback((tempId: string, updates: Partial<ExamSection>) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.tempId === tempId ? { ...s, ...updates } : s
      ),
    }));
    setIsDirty(true);
  }, []);

  const removeSection = useCallback((tempId: string) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections
        .filter(s => s.tempId !== tempId)
        .map((s, i) => ({ ...s, sectionOrder: i + 1 })),
    }));
    setIsDirty(true);
  }, []);

  const reorderSections = useCallback((newOrder: string[]) => {
    setFormData(prev => ({
      ...prev,
      sections: newOrder
        .map((tempId, index) => {
          const section = prev.sections.find(s => s.tempId === tempId);
          return section ? { ...section, sectionOrder: index + 1 } : null;
        })
        .filter((s): s is ExamSection => s !== null),
    }));
    setIsDirty(true);
  }, []);

  // Question operations
  const addQuestion = useCallback((sectionTempId: string, question: Omit<ExamQuestion, "tempId">) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.tempId === sectionTempId
          ? { ...s, questions: [...s.questions, { ...question, tempId: generateTempId() }] }
          : s
      ),
    }));
    setIsDirty(true);
  }, []);

  const updateQuestion = useCallback((sectionTempId: string, questionTempId: string, updates: Partial<ExamQuestion>) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.tempId === sectionTempId
          ? {
              ...s,
              questions: s.questions.map(q =>
                q.tempId === questionTempId ? { ...q, ...updates } : q
              ),
            }
          : s
      ),
    }));
    setIsDirty(true);
  }, []);

  const removeQuestion = useCallback((sectionTempId: string, questionTempId: string) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.tempId === sectionTempId
          ? { ...s, questions: s.questions.filter(q => q.tempId !== questionTempId) }
          : s
      ),
    }));
    setIsDirty(true);
  }, []);

  const reorderQuestions = useCallback((sectionTempId: string, newOrder: string[]) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.map(s =>
        s.tempId === sectionTempId
          ? {
              ...s,
              questions: newOrder
                .map(tempId => s.questions.find(q => q.tempId === tempId))
                .filter((q): q is ExamQuestion => q !== undefined),
            }
          : s
      ),
    }));
    setIsDirty(true);
  }, []);

  // Blueprint operations
  const updateBlueprint = useCallback((tempQuestionId: string, blueprint: Partial<EvaluationBlueprint>) => {
    setFormData(prev => {
      const existing = prev.blueprints.find(b => b.tempQuestionId === tempQuestionId);
      if (existing) {
        return {
          ...prev,
          blueprints: prev.blueprints.map(b =>
            b.tempQuestionId === tempQuestionId ? { ...b, ...blueprint } : b
          ),
        };
      }
      // Create new blueprint
      return {
        ...prev,
        blueprints: [
          ...prev.blueprints,
          {
            questionId: "",
            tempQuestionId,
            maxMarks: 0,
            markingScheme: "",
            keywords: [],
            partialMarkingAllowed: true,
            negativeMarking: 0,
            aiEvaluationEnabled: false,
            aiConfidenceThreshold: 0.75,
            coreConcepts: [],
            expectedStructure: "",
            weightage: [],
            ...blueprint,
          },
        ],
      };
    });
    setIsDirty(true);
  }, []);

  // Compute stats
  const stats = useMemo<ExamStats>(() => {
    const allQuestions = formData.sections.flatMap(s => s.questions);
    const objectiveTypes: string[] = ["mcq", "true_false", "fill_blank"];
    const subjectiveTypes: string[] = ["short_answer", "long_answer"];
    
    const objectiveQuestions = allQuestions.filter(q => 
      objectiveTypes.includes(q.questionType)
    ).length;
    
    const subjectiveQuestions = allQuestions.filter(q => 
      subjectiveTypes.includes(q.questionType)
    ).length;

    const blueprintsRequired = allQuestions.filter(q => 
      subjectiveTypes.includes(q.questionType)
    ).length;

    const blueprintsCovered = formData.blueprints.filter(b => 
      b.markingScheme && b.markingScheme.length > 0
    ).length;

    return {
      totalSections: formData.sections.length,
      totalQuestions: allQuestions.length,
      totalMarks: allQuestions.reduce((sum, q) => sum + q.marks, 0),
      objectiveQuestions,
      subjectiveQuestions,
      blueprintsCovered,
      blueprintsRequired,
    };
  }, [formData]);

  // Validation
  const validateStep = useCallback((step: WizardStep): ValidationError[] => {
    const errors: ValidationError[] = [];

    switch (step) {
      case "details":
        if (!formData.context.institutionId) {
          errors.push({ field: "institutionId", message: "Institution is required" });
        }
        if (formData.context.classIds.length === 0) {
          errors.push({ field: "classIds", message: "At least one class must be selected" });
        }
        if (formData.context.subjectIds.length === 0) {
          errors.push({ field: "subjectIds", message: "At least one subject must be selected" });
        }
        if (formData.context.chapterIds.length === 0) {
          errors.push({ field: "chapterIds", message: "At least one chapter must be selected" });
        }
        if (!formData.metadata.title.trim()) {
          errors.push({ field: "title", message: "Exam title is required" });
        }
        if (!formData.metadata.examMode) {
          errors.push({ field: "examMode", message: "Exam mode is required" });
        }
        if (formData.metadata.examMode === "hybrid") {
          const hs = formData.metadata.hybridSettings;
          if (!hs) {
            errors.push({ field: "hybridSettings", message: "Hybrid settings are required" });
          } else {
            if (hs.graceWindowMinutes < 5 || hs.graceWindowMinutes > 120) {
              errors.push({ field: "graceWindowMinutes", message: "Grace window must be between 5 and 120 minutes" });
            }
            if (hs.maxPages < 1 || hs.maxPages > 50) {
              errors.push({ field: "maxPages", message: "Max pages must be between 1 and 50" });
            }
            if (!hs.sheetNumberingInstruction.trim()) {
              errors.push({ field: "sheetNumberingInstruction", message: "Sheet numbering instruction is required" });
            }
          }
        }
        break;

      case "sections":
        if (formData.sections.length === 0) {
          errors.push({ field: "sections", message: "At least one section is required" });
        }
        formData.sections.forEach((s, i) => {
          if (!s.title.trim()) {
            errors.push({ field: `section_${i}_title`, message: `Section ${i + 1} needs a title` });
          }
          // Fix #5: Each section must have at least one question type with count > 0
          const totalQuestions = Object.values(s.questionTypeCounts || {}).reduce((sum, c) => sum + c, 0);
          if ((s.allowedQuestionTypes || []).length === 0 || totalQuestions === 0) {
            errors.push({ field: `section_${i}_questions`, message: `Section ${i + 1} needs at least one question type with a count > 0` });
          }
        });
        break;

      case "questions":
        if (stats.totalQuestions === 0) {
          errors.push({ field: "questions", message: "At least one question is required" });
        }
        formData.sections.forEach((s, si) => {
          s.questions.forEach((q, qi) => {
            if (!q.questionText.trim()) {
              errors.push({ 
                field: `question_${si}_${qi}`, 
                message: `Question ${qi + 1} in Section ${si + 1} needs text` 
              });
            }
          });
        });
        break;

      case "review":
        return [
          ...validateStep("details"),
          ...validateStep("sections"),
          ...validateStep("questions"),
        ];
    }

    return errors;
  }, [formData, stats]);

  const isStepValid = useCallback((step: WizardStep): boolean => {
    return validateStep(step).length === 0;
  }, [validateStep]);

  const canPublish = useMemo(() => {
    return validateStep("review").length === 0;
  }, [validateStep]);

  // Step navigation
  const steps = useMemo<WizardStep[]>(() => ["details", "sections", "questions", "review"], []);

  const currentStepIndex = steps.indexOf(currentStep);
  
  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
  }, []);

  const nextStep = useCallback((): boolean => {
    // Only allow navigation if current step is valid
    const currentErrors = validateStep(currentStep);
    if (currentErrors.length > 0) {
      return false; // Return false to indicate navigation was blocked
    }
    const nextIndex = Math.min(currentStepIndex + 1, steps.length - 1);
    setCurrentStep(steps[nextIndex]);
    return true;
  }, [currentStepIndex, steps, currentStep, validateStep]);

  const prevStep = useCallback(() => {
    const prevIndex = Math.max(currentStepIndex - 1, 0);
    setCurrentStep(steps[prevIndex]);
  }, [currentStepIndex, steps]);

  // Reset form
  const resetForm = useCallback(() => {
    setFormData(initialFormData);
    setCurrentStep("details");
    setIsDirty(false);
  }, []);

  // Hydrate form state from an existing exam or a template snapshot
  const loadForm = useCallback((data: ExamFormData) => {
    setFormData({
      ...initialFormData,
      ...data,
      metadata: { ...initialFormData.metadata, ...data.metadata },
      context: { ...initialFormData.context, ...data.context },
      sections: (data.sections || []).map((s, i) => ({
        ...s,
        tempId: s.tempId || generateTempId(),
        sectionOrder: s.sectionOrder ?? i + 1,
        questions: (s.questions || []).map((q) => ({
          ...q,
          tempId: q.tempId || generateTempId(),
        })),
      })),
    });
    setIsDirty(false);
  }, []);

  // Completion stats per section / per type group — used by the QuestionsScreen
  // progress bars and the Review-disable logic.
  type GroupCompletion = {
    type: string;
    target: number;
    actual: number;
    percent: number; // 0..100
  };
  type SectionCompletion = {
    sectionTempId: string;
    title: string;
    totalTarget: number;
    totalActual: number;
    percent: number;
    groups: GroupCompletion[];
  };

  const completionStats = useMemo<SectionCompletion[]>(() => {
    return formData.sections.map((s) => {
      const counts = s.questionTypeCounts || {};
      const actualByType = s.questions.reduce<Record<string, number>>((acc, q) => {
        const key = String(q.questionType);
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {});

      const typeKeys = new Set<string>([
        ...Object.keys(counts),
        ...Object.keys(actualByType),
      ]);

      const groups: GroupCompletion[] = Array.from(typeKeys).map((type) => {
        const target = counts[type] ?? 0;
        const actual = actualByType[type] ?? 0;
        const percent = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : actual > 0 ? 100 : 0;
        return { type, target, actual, percent };
      });

      const totalTarget = groups.reduce((sum, g) => sum + g.target, 0);
      const totalActual = groups.reduce((sum, g) => sum + g.actual, 0);
      const percent = totalTarget > 0 ? Math.min(100, Math.round((totalActual / totalTarget) * 100)) : 0;

      return {
        sectionTempId: s.tempId,
        title: s.title,
        totalTarget,
        totalActual,
        percent,
        groups,
      };
    });
  }, [formData.sections]);

  const isComplete = useMemo(() => {
    if (completionStats.length === 0) return false;
    return completionStats.every(
      (sc) => sc.totalTarget > 0 && sc.groups.every((g) => g.target > 0 && g.actual >= g.target)
    );
  }, [completionStats]);

  return {
    formData,
    currentStep,
    currentStepIndex,
    steps,
    isDirty,
    stats,
    canPublish,
    // Updates
    updateContext,
    updateMetadata,
    setExamId, // For setting exam ID after first save
    // Sections
    addSection,
    updateSection,
    removeSection,
    reorderSections,
    // Questions
    addQuestion,
    updateQuestion,
    removeQuestion,
    reorderQuestions,
    // Blueprints
    updateBlueprint,
    // Navigation
    goToStep,
    nextStep,
    prevStep,
    // Validation
    validateStep,
    isStepValid,
    // Reset / hydration
    resetForm,
    loadForm,
    // Completion tracking
    completionStats,
    isComplete,
  };
}
