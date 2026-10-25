import { useState, useCallback, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { 
  ExamFormData, 
  ExamSection, 
  ExamQuestion, 
  EvaluationBlueprint,
  WizardStep,
  ExamStats,
  ValidationError,
  QuestionOption,
} from "@/types/exam";

interface UseExamEditorOptions {
  examId: string;
}

export function useExamEditor({ examId }: UseExamEditorOptions) {
  const [formData, setFormData] = useState<ExamFormData | null>(null);
  const [currentStep, setCurrentStep] = useState<WizardStep>("details");
  const [isDirty, setIsDirty] = useState(false);
  const [deletedSectionIds, setDeletedSectionIds] = useState<string[]>([]);
  const [deletedQuestionIds, setDeletedQuestionIds] = useState<string[]>([]);

  // Fetch existing exam data
  const { data: examData, isLoading, error } = useQuery({
    queryKey: ["exam-editor", examId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("exams")
        .select(`
          *,
          exam_sections (
            id, title, description, instructions, section_order, section_type,
            default_marks, negative_marking,
            exam_questions (
              id, question_text, question_type, marks, negative_marks,
              options, correct_answer, explanation, difficulty_level, tags, question_order, image_url
            )
          ),
          exam_classes (class_id),
          exam_subjects (subject_id),
          exam_topics (topic_id, custom_topic_id),
          evaluation_blueprints (
            id, question_id, max_marks, marking_scheme, keywords,
            partial_marking_allowed, negative_marking, ai_evaluation_enabled, ai_confidence_threshold
          )
        `)
        .eq("id", examId)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!examId,
  });

  // Transform DB data to form data when loaded
  useEffect(() => {
    if (!examData) return;

    const sections: ExamSection[] = (examData.exam_sections || [])
      .sort((a: any, b: any) => a.section_order - b.section_order)
      .map((section: any) => ({
        id: section.id,
        tempId: section.id,
        sectionType: section.section_type || "mcq",
        title: section.title,
        description: section.description || "",
        instructions: section.instructions || "",
        sectionOrder: section.section_order,
        defaultMarks: section.default_marks || 1,
        negativeMarking: section.negative_marking || 0,
        questions: (section.exam_questions || [])
          .sort((a: any, b: any) => a.question_order - b.question_order)
          .map((q: any): ExamQuestion => ({
            id: q.id,
            tempId: q.id,
            questionText: q.question_text,
            questionType: q.question_type,
            marks: q.marks,
            negativeMarks: q.negative_marks || 0,
            options: q.options as QuestionOption[] | null,
            correctAnswer: q.correct_answer,
            explanation: q.explanation,
            difficultyLevel: q.difficulty_level || 1,
            tags: q.tags || [],
            imageUrl: q.image_url || undefined,
          })),
      }));

    const blueprints: EvaluationBlueprint[] = (examData.evaluation_blueprints || []).map((bp: any) => ({
      questionId: bp.question_id,
      tempQuestionId: bp.question_id,
      maxMarks: bp.max_marks,
      markingScheme: bp.marking_scheme || "",
      keywords: bp.keywords || [],
      partialMarkingAllowed: bp.partial_marking_allowed,
      negativeMarking: bp.negative_marking || 0,
      aiEvaluationEnabled: bp.ai_evaluation_enabled,
      aiConfidenceThreshold: bp.ai_confidence_threshold || 0.75,
      coreConcepts: [],
      expectedStructure: "",
      weightage: [],
    }));

    const transformed: ExamFormData = {
      context: {
        institutionId: examData.institution_id,
        classIds: examData.exam_classes?.map((ec: any) => ec.class_id) || [],
        subjectIds: examData.exam_subjects?.map((es: any) => es.subject_id) || [],
        topicIds: examData.exam_topics?.filter((et: any) => et.topic_id).map((et: any) => et.topic_id) || [],
        customTopicIds: examData.exam_topics?.filter((et: any) => et.custom_topic_id).map((et: any) => et.custom_topic_id) || [],
        chapterIds: [],
      },
      metadata: {
        title: examData.title,
        description: examData.description || "",
        examMode: examData.exam_mode,
        scheduledDate: examData.scheduled_date ? new Date(examData.scheduled_date) : null,
        startTime: examData.start_time ? new Date(examData.start_time).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "",
        endTime: examData.end_time ? new Date(examData.end_time).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" }) : "",
        durationMinutes: examData.duration_minutes || 60,
        passMarks: examData.pass_marks,
        instructions: examData.instructions || "",
        ocrConfidenceThreshold: (examData.ocr_confidence_threshold || 0.7) * 100,
      },
      sections,
      blueprints,
    };

    setFormData(transformed);
  }, [examData]);

  // Update context
  const updateContext = useCallback((context: Partial<ExamFormData["context"]>) => {
    setFormData(prev => prev ? ({
      ...prev,
      context: { ...prev.context, ...context },
    }) : null);
    setIsDirty(true);
  }, []);

  // Update metadata
  const updateMetadata = useCallback((metadata: Partial<ExamFormData["metadata"]>) => {
    setFormData(prev => prev ? ({
      ...prev,
      metadata: { ...prev.metadata, ...metadata },
    }) : null);
    setIsDirty(true);
  }, []);

  // Section operations
  const generateTempId = () => `temp_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  const addSection = useCallback((section: Omit<ExamSection, "tempId" | "sectionOrder">) => {
    setFormData(prev => prev ? ({
      ...prev,
      sections: [
        ...prev.sections,
        {
          ...section,
          tempId: generateTempId(),
          sectionOrder: prev.sections.length + 1,
          sectionType: section.sectionType || "mcq",
          defaultMarks: section.defaultMarks || 1,
          negativeMarking: section.negativeMarking || 0,
          questions: section.questions || [],
        },
      ],
    }) : null);
    setIsDirty(true);
  }, []);

  const updateSection = useCallback((tempId: string, updates: Partial<ExamSection>) => {
    setFormData(prev => prev ? ({
      ...prev,
      sections: prev.sections.map(s =>
        s.tempId === tempId ? { ...s, ...updates } : s
      ),
    }) : null);
    setIsDirty(true);
  }, []);

  const removeSection = useCallback((tempId: string) => {
    setFormData(prev => {
      if (!prev) return null;
      const section = prev.sections.find(s => s.tempId === tempId);
      if (section?.id) {
        setDeletedSectionIds(ids => [...ids, section.id!]);
        // Also track all questions in this section for deletion
        section.questions.forEach(q => {
          if (q.id) {
            setDeletedQuestionIds(ids => [...ids, q.id!]);
          }
        });
      }
      return {
        ...prev,
        sections: prev.sections
          .filter(s => s.tempId !== tempId)
          .map((s, i) => ({ ...s, sectionOrder: i + 1 })),
      };
    });
    setIsDirty(true);
  }, []);

  const reorderSections = useCallback((newOrder: string[]) => {
    setFormData(prev => prev ? ({
      ...prev,
      sections: newOrder
        .map((tempId, index) => {
          const section = prev.sections.find(s => s.tempId === tempId);
          return section ? { ...section, sectionOrder: index + 1 } : null;
        })
        .filter((s): s is ExamSection => s !== null),
    }) : null);
    setIsDirty(true);
  }, []);

  // Question operations
  const addQuestion = useCallback((sectionTempId: string, question: Omit<ExamQuestion, "tempId">) => {
    setFormData(prev => prev ? ({
      ...prev,
      sections: prev.sections.map(s =>
        s.tempId === sectionTempId
          ? { ...s, questions: [...s.questions, { ...question, tempId: generateTempId() }] }
          : s
      ),
    }) : null);
    setIsDirty(true);
  }, []);

  const updateQuestion = useCallback((sectionTempId: string, questionTempId: string, updates: Partial<ExamQuestion>) => {
    setFormData(prev => prev ? ({
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
    }) : null);
    setIsDirty(true);
  }, []);

  const removeQuestion = useCallback((sectionTempId: string, questionTempId: string) => {
    setFormData(prev => {
      if (!prev) return null;
      const section = prev.sections.find(s => s.tempId === sectionTempId);
      const question = section?.questions.find(q => q.tempId === questionTempId);
      if (question?.id) {
        setDeletedQuestionIds(ids => [...ids, question.id!]);
      }
      return {
        ...prev,
        sections: prev.sections.map(s =>
          s.tempId === sectionTempId
            ? { ...s, questions: s.questions.filter(q => q.tempId !== questionTempId) }
            : s
        ),
      };
    });
    setIsDirty(true);
  }, []);

  const reorderQuestions = useCallback((sectionTempId: string, newOrder: string[]) => {
    setFormData(prev => prev ? ({
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
    }) : null);
    setIsDirty(true);
  }, []);

  // Blueprint operations
  const updateBlueprint = useCallback((tempQuestionId: string, blueprint: Partial<EvaluationBlueprint>) => {
    setFormData(prev => {
      if (!prev) return null;
      const existing = prev.blueprints.find(b => b.tempQuestionId === tempQuestionId);
      if (existing) {
        return {
          ...prev,
          blueprints: prev.blueprints.map(b =>
            b.tempQuestionId === tempQuestionId ? { ...b, ...blueprint } : b
          ),
        };
      }
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
    if (!formData) {
      return {
        totalSections: 0,
        totalQuestions: 0,
        totalMarks: 0,
        objectiveQuestions: 0,
        subjectiveQuestions: 0,
        blueprintsCovered: 0,
        blueprintsRequired: 0,
      };
    }

    const allQuestions = formData.sections.flatMap(s => s.questions);
    const objectiveTypes: string[] = ["mcq", "true_false", "fill_blank", "matching"];
    const subjectiveTypes: string[] = ["short_answer", "long_answer", "comprehension", "case_study"];
    
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
    if (!formData) return [{ field: "form", message: "Form data not loaded" }];
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
        if (!formData.metadata.title.trim()) {
          errors.push({ field: "title", message: "Exam title is required" });
        }
        if (!formData.metadata.examMode) {
          errors.push({ field: "examMode", message: "Exam mode is required" });
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
  const steps: WizardStep[] = ["details", "sections", "questions", "review"];
  const currentStepIndex = steps.indexOf(currentStep);
  
  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
  }, []);

  const nextStep = useCallback(() => {
    const nextIndex = Math.min(currentStepIndex + 1, steps.length - 1);
    setCurrentStep(steps[nextIndex]);
  }, [currentStepIndex, steps]);

  const prevStep = useCallback(() => {
    const prevIndex = Math.max(currentStepIndex - 1, 0);
    setCurrentStep(steps[prevIndex]);
  }, [currentStepIndex, steps]);

  return {
    formData,
    currentStep,
    currentStepIndex,
    steps,
    isDirty,
    stats,
    canPublish,
    isLoading,
    error,
    examStatus: examData?.status,
    deletedSectionIds,
    deletedQuestionIds,
    // Updates
    updateContext,
    updateMetadata,
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
  };
}
