import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus,
  Trash2,
  HelpCircle,
  CheckCircle2,
  ToggleLeft,
  AlignLeft,
  FileText,
  BookOpen,
  Briefcase,
  Shuffle,
  FileQuestion,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { MathToolbar } from "@/components/ui/math-toolbar";
import { MathPreview } from "@/components/ui/math-preview";
import { MathText } from "@/components/ui/math-text";
import { MathSymbolHint } from "@/components/shared/symbol-picker";
import { QuestionImageUpload } from "@/components/ui/question-image-upload";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useChaptersForExam } from "@/hooks/useChaptersForExam";
import { useChapterTopics } from "@/hooks/useChapterTopics";
import { useQuestionScope } from "@/hooks/useQuestionScope";
import type {
  ExamSection,
  ExamQuestion,
  QuestionType,
  QuestionOption,
} from "@/types/exam";
import { toDbQuestionType } from "@/types/exam";

interface ManualQuestionFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string;
  classId: string;
  className?: string;
  classSection?: string;
  subjectId: string;
  subjectName?: string;
  sectionChapterIds: string[];
  /** Pre-filled question type from the section — user can change it if section is mixed-type. */
  questionType: QuestionType;
  /** Set to false to lock questionType (section is type-specific). */
  allowTypeChange?: boolean;
  section: ExamSection;
  onAddQuestion: (
    sectionTempId: string,
    question: Omit<ExamQuestion, "tempId">
  ) => void;
  onUpdateQuestion?: (
    sectionTempId: string,
    questionTempId: string,
    updates: Partial<ExamQuestion>
  ) => void;
  editingQuestion?: ExamQuestion | null;
}

const questionTypes: {
  value: QuestionType;
  label: string;
  icon: typeof HelpCircle;
}[] = [
  { value: "mcq", label: "Multiple Choice", icon: CheckCircle2 },
  { value: "true_false", label: "True/False", icon: ToggleLeft },
  { value: "short_answer", label: "Short Answer", icon: AlignLeft },
  { value: "long_answer", label: "Long Answer", icon: FileText },
  { value: "fill_blank", label: "Fill in the Blank", icon: FileQuestion },
  { value: "matching", label: "Matching", icon: Shuffle },
  { value: "comprehension", label: "Comprehension", icon: BookOpen },
  { value: "case_study", label: "Case Study", icon: Briefcase },
];

interface SubQuestion {
  id: string;
  text: string;
  marks: number;
  answer: string;
}

interface FormState {
  questionText: string;
  questionType: QuestionType;
  marks: number;
  negativeMarks: number;
  options: QuestionOption[] | null;
  correctAnswer: string | null;
  explanation: string | null;
  difficultyLevel: number;
  tags: string[];
  matchingColumnA: string[];
  matchingColumnB: string[];
  subQuestions: SubQuestion[];
  imageUrl: string | null;
}

const defaultsForType = (
  type: QuestionType,
  marks: number,
  negative: number
): FormState => {
  const base: FormState = {
    questionText: "",
    questionType: type,
    marks,
    negativeMarks: negative,
    options: null,
    correctAnswer: null,
    explanation: null,
    difficultyLevel: 2,
    tags: [],
    matchingColumnA: ["", "", "", ""],
    matchingColumnB: ["", "", "", ""],
    subQuestions: [],
    imageUrl: null,
  };

  if (type === "mcq") {
    return {
      ...base,
      options: [
        { id: "a", text: "" },
        { id: "b", text: "" },
        { id: "c", text: "" },
        { id: "d", text: "" },
      ],
    };
  }
  if (type === "true_false") {
    return {
      ...base,
      options: [
        { id: "t", text: "True" },
        { id: "f", text: "False" },
      ],
    };
  }
  if (type === "fill_blank") {
    return { ...base, questionText: "The ____ is ____.", correctAnswer: "" };
  }
  if (type === "short_answer") {
    return { ...base, correctAnswer: "" };
  }
  if (type === "long_answer") {
    return { ...base, marks: Math.max(marks, 5), correctAnswer: "" };
  }
  if (type === "comprehension" || type === "case_study") {
    return {
      ...base,
      subQuestions: [
        { id: crypto.randomUUID(), text: "", marks: 2, answer: "" },
        { id: crypto.randomUUID(), text: "", marks: 2, answer: "" },
      ],
    };
  }
  return base;
};

/**
 * Context-aware manual question entry dialog. Pre-fills class/subject as
 * read-only, scopes chapter/topic to the section's selected chapters, and
 * dual-writes each saved question to both the exam and the question bank.
 */
export function ManualQuestionForm({
  open,
  onOpenChange,
  institutionId,
  classId,
  className,
  classSection,
  subjectId,
  subjectName,
  sectionChapterIds,
  questionType,
  allowTypeChange = true,
  section,
  onAddQuestion,
  onUpdateQuestion,
  editingQuestion,
}: ManualQuestionFormProps) {
  const { toast } = useToast();
  const questionTextareaRef = useRef<HTMLTextAreaElement>(null);

  const isSingleChapter = sectionChapterIds.length === 1;
  const [selectedChapterId, setSelectedChapterId] = useState<string>(
    sectionChapterIds[0] ?? ""
  );
  const [selectedTopicId, setSelectedTopicId] = useState<string>("");

  const [formData, setFormData] = useState<FormState>(() =>
    defaultsForType(
      questionType,
      section.defaultMarks || 1,
      section.negativeMarking || 0
    )
  );

  // When dialog opens fresh or editingQuestion changes, seed the form
  useEffect(() => {
    if (!open) return;

    if (editingQuestion) {
      // Hydrate matching/sub-question data for edit mode
      let columnA: string[] = ["", "", "", ""];
      let columnB: string[] = ["", "", "", ""];
      if (editingQuestion.questionType === "matching" && editingQuestion.options) {
        const o = editingQuestion.options as unknown as {
          columnA?: string[];
          columnB?: string[];
        };
        columnA = o.columnA || columnA;
        columnB = o.columnB || columnB;
      }
      const subs: SubQuestion[] =
        editingQuestion.subQuestions?.map((sq) => ({
          id: sq.tempId || crypto.randomUUID(),
          text: sq.questionText,
          marks: sq.marks,
          answer: sq.correctAnswer || "",
        })) ?? [];

      setFormData({
        questionText: editingQuestion.questionText,
        questionType: editingQuestion.questionType,
        marks: editingQuestion.marks,
        negativeMarks: editingQuestion.negativeMarks,
        options:
          editingQuestion.options ||
          (["mcq", "true_false"].includes(editingQuestion.questionType)
            ? [
                { id: "a", text: "" },
                { id: "b", text: "" },
                { id: "c", text: "" },
                { id: "d", text: "" },
              ]
            : null),
        correctAnswer: editingQuestion.correctAnswer,
        explanation: editingQuestion.explanation,
        difficultyLevel: editingQuestion.difficultyLevel,
        tags: editingQuestion.tags,
        matchingColumnA: columnA,
        matchingColumnB: columnB,
        subQuestions: subs,
        imageUrl: editingQuestion.imageUrl || null,
      });
    } else {
      setFormData(
        defaultsForType(
          questionType,
          section.defaultMarks || 1,
          section.negativeMarking || 0
        )
      );
    }

    setSelectedChapterId(sectionChapterIds[0] ?? "");
    setSelectedTopicId("");
  }, [open, editingQuestion, questionType, section, sectionChapterIds]);

  // Reset topic when chapter changes
  useEffect(() => {
    setSelectedTopicId("");
  }, [selectedChapterId]);

  // Resolve chapter names for display / dropdown
  const { data: allChapters } = useChaptersForExam({ classId, subjectId });
  const chapters = useMemo(
    () =>
      (allChapters ?? []).filter((c) => sectionChapterIds.includes(c.id)),
    [allChapters, sectionChapterIds]
  );
  const selectedChapter = chapters.find((c) => c.id === selectedChapterId);

  // Topics for the selected chapter
  const { data: topics = [] } = useChapterTopics({
    institutionId,
    classId,
    subjectId,
    chapterId: selectedChapterId || undefined,
  });

  // We no longer expose a per-upload audience picker — every saved question
  // is class-wide (zero rows in question_bank_section_scope). The hook is
  // kept solely to resolve the class_group_id for the question_bank row.
  const scope = useQuestionScope({ institutionId, classId, subjectId });

  const isMatching = formData.questionType === "matching";
  const isFillBlank = formData.questionType === "fill_blank";
  const isComprehensionOrCaseStudy = [
    "comprehension",
    "case_study",
  ].includes(formData.questionType);
  const needsOptions = ["mcq", "true_false"].includes(formData.questionType);

  const updateOption = (index: number, text: string) => {
    const opts = [...(formData.options || [])];
    opts[index] = { ...opts[index], text };
    setFormData((p) => ({ ...p, options: opts }));
  };

  const updateOptionImage = (index: number, imageUrl: string | null) => {
    const opts = [...(formData.options || [])];
    opts[index] = { ...opts[index], imageUrl };
    setFormData((p) => ({ ...p, options: opts }));
  };

  const updateMatchingColumn = (
    column: "A" | "B",
    index: number,
    value: string
  ) => {
    setFormData((p) => {
      const key = column === "A" ? "matchingColumnA" : "matchingColumnB";
      const next = [...p[key]];
      next[index] = value;
      return { ...p, [key]: next };
    });
  };

  const addMatchingPair = () =>
    setFormData((p) => ({
      ...p,
      matchingColumnA: [...p.matchingColumnA, ""],
      matchingColumnB: [...p.matchingColumnB, ""],
    }));

  const removeMatchingPair = (index: number) =>
    setFormData((p) => ({
      ...p,
      matchingColumnA: p.matchingColumnA.filter((_, i) => i !== index),
      matchingColumnB: p.matchingColumnB.filter((_, i) => i !== index),
    }));

  const updateSubQuestion = (
    index: number,
    field: keyof SubQuestion,
    value: string | number
  ) =>
    setFormData((p) => {
      const next = [...p.subQuestions];
      next[index] = { ...next[index], [field]: value };
      return { ...p, subQuestions: next };
    });

  const addSubQuestion = () =>
    setFormData((p) => ({
      ...p,
      subQuestions: [
        ...p.subQuestions,
        { id: crypto.randomUUID(), text: "", marks: 2, answer: "" },
      ],
    }));

  const removeSubQuestion = (index: number) =>
    setFormData((p) => ({
      ...p,
      subQuestions: p.subQuestions.filter((_, i) => i !== index),
    }));

  const saveToBank = async (
    built: Omit<ExamQuestion, "tempId">,
    chapterId: string,
    chapterTopicId: string | null
  ) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: inserted, error } = await supabase
        .from("question_bank")
        .insert({
          institution_id: institutionId,
          subject_id: subjectId,
          topic_id: chapterId || null,
          chapter_topic_id: chapterTopicId,
          class_group_id: scope.classGroupId,
          question_text: built.questionText,
          question_type: toDbQuestionType(built.questionType),
          options: built.options as never,
          correct_answer: built.correctAnswer,
          explanation: built.explanation,
          marks: built.marks,
          difficulty_level: built.difficultyLevel,
          tags: built.tags,
          image_url: built.imageUrl || null,
          created_by: user.id,
          is_approved: true,
          source: "manual",
        })
        .select("id")
        .single();

      if (error || !inserted) {
        console.warn("Failed to save question to bank:", error);
        return;
      }
    } catch (err) {
      // Non-fatal — the question is already in the exam. Log and continue.
      console.warn("Failed to save question to bank:", err);
    }
  };

  const handleSave = async () => {
    if (!formData.questionText.trim()) return;

    // Chapter is required when multiple chapters — lock-in and block save otherwise
    if (!selectedChapterId) {
      toast({
        title: "Chapter required",
        description: "Please pick a chapter before saving.",
        variant: "destructive",
      });
      return;
    }

    let finalOptions: QuestionOption[] | null = formData.options;
    let subs: ExamQuestion[] | undefined;
    let totalMarks = formData.marks;
    let correctAnswer = formData.correctAnswer;

    if (isMatching) {
      const validA = formData.matchingColumnA.filter((a) => a.trim());
      const validB = formData.matchingColumnB.filter((b) => b.trim());
      if (validA.length === 0 || validB.length === 0) return;
      finalOptions = validA.map((item, i) => ({
        id: String(i + 1),
        text: item,
        isCorrect: false,
      }));
      correctAnswer = JSON.stringify({
        columnA: validA,
        columnB: validB,
        matches: validA.map((_, i) => `${i + 1}-${validB[i] || ""}`).join(", "),
      });
    }

    if (isComprehensionOrCaseStudy) {
      const validSubs = formData.subQuestions.filter((sq) => sq.text.trim());
      if (validSubs.length === 0) return;
      subs = validSubs.map((sq) => ({
        tempId: sq.id,
        questionText: sq.text,
        questionType: "short_answer" as QuestionType,
        marks: sq.marks,
        negativeMarks: 0,
        options: null,
        correctAnswer: sq.answer || null,
        explanation: null,
        difficultyLevel: formData.difficultyLevel,
        tags: [],
      }));
      totalMarks = validSubs.reduce((sum, sq) => sum + sq.marks, 0);
    }

    const built: Omit<ExamQuestion, "tempId"> = {
      questionText: formData.questionText,
      questionType: formData.questionType,
      marks: totalMarks,
      negativeMarks: formData.negativeMarks,
      options: finalOptions,
      correctAnswer,
      explanation: formData.explanation,
      difficultyLevel: formData.difficultyLevel,
      tags: formData.tags,
      subQuestions: subs,
      imageUrl: formData.imageUrl || undefined,
    };

    if (editingQuestion && onUpdateQuestion) {
      onUpdateQuestion(section.tempId, editingQuestion.tempId, built);
    } else {
      onAddQuestion(section.tempId, built);
      // Dual-write to bank only for new questions (edits leave the bank copy alone)
      await saveToBank(
        built,
        selectedChapterId,
        selectedTopicId || null
      );
    }

    onOpenChange(false);
  };

  const chapterLabel = (c: {
    topicName: string;
    chapterNumber: number | null;
  }) =>
    c.chapterNumber ? `Ch ${c.chapterNumber}: ${c.topicName}` : c.topicName;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingQuestion ? "Edit Question" : "Add Question"}
            <span className="text-muted-foreground font-normal ml-2">
              · {section.title}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Read-only context row */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Class</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {className || "N/A"}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Section</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {classSection || "N/A"}
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {subjectName || "N/A"}
              </div>
            </div>
          </div>

          {/* Chapter */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Chapter *</Label>
            {isSingleChapter ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                {selectedChapter ? chapterLabel(selectedChapter) : "N/A"}
              </div>
            ) : (
              <Select
                value={selectedChapterId}
                onValueChange={setSelectedChapterId}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a chapter" />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {chapterLabel(c)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Topic (optional) — only when topics exist */}
          {topics.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Topic (optional)
              </Label>
              <Select
                value={selectedTopicId || "__none__"}
                onValueChange={(v) =>
                  setSelectedTopicId(v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No specific topic</SelectItem>
                  {topics.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <Separator />

          {/* Marks */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="marks">
                {isComprehensionOrCaseStudy
                  ? "Total Marks (auto)"
                  : "Marks"}
              </Label>
              <Input
                id="marks"
                type="number"
                min={0}
                step={0.5}
                value={
                  isComprehensionOrCaseStudy
                    ? formData.subQuestions.reduce((s, sq) => s + sq.marks, 0)
                    : formData.marks
                }
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    marks: parseFloat(e.target.value) || 0,
                  }))
                }
                disabled={isComprehensionOrCaseStudy}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="negative">Negative Marking</Label>
              <Input
                id="negative"
                type="number"
                min={0}
                step={0.25}
                value={formData.negativeMarks}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    negativeMarks: parseFloat(e.target.value) || 0,
                  }))
                }
              />
            </div>
          </div>

          {/* Question Type (locked unless mixed-type section) */}
          <div className="space-y-2">
            <Label>Question Type</Label>
            <Select
              value={formData.questionType}
              disabled={!allowTypeChange}
              onValueChange={(value) => {
                const newType = value as QuestionType;
                const defaults = defaultsForType(
                  newType,
                  formData.marks,
                  formData.negativeMarks
                );
                setFormData((p) => ({
                  ...defaults,
                  questionText:
                    newType === "fill_blank" && !p.questionText
                      ? defaults.questionText
                      : p.questionText,
                  marks: newType === "long_answer" ? Math.max(p.marks, 5) : p.marks,
                  negativeMarks: p.negativeMarks,
                  explanation: p.explanation,
                  difficultyLevel: p.difficultyLevel,
                  tags: p.tags,
                  imageUrl: p.imageUrl,
                }));
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {questionTypes.map((qt) => {
                  const Icon = qt.icon;
                  return (
                    <SelectItem key={qt.value} value={qt.value}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {qt.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Question Text */}
          <div className="space-y-2">
            <Label htmlFor="question-text">
              {isComprehensionOrCaseStudy
                ? formData.questionType === "comprehension"
                  ? "Passage *"
                  : "Case Study Scenario *"
                : isFillBlank
                  ? "Question (use ____ for blanks) *"
                  : isMatching
                    ? "Instructions *"
                    : "Question *"}
            </Label>
            <MathToolbar
              textareaRef={questionTextareaRef}
              onInsert={(newValue) =>
                setFormData((p) => ({ ...p, questionText: newValue }))
              }
            />
            <Textarea
              id="question-text"
              ref={questionTextareaRef}
              placeholder={
                isComprehensionOrCaseStudy
                  ? formData.questionType === "comprehension"
                    ? "Enter the reading passage..."
                    : "Describe the case study scenario..."
                  : isFillBlank
                    ? "Example: The capital of France is ____."
                    : isMatching
                      ? "Match the following items from Column A with Column B."
                      : "Enter your question..."
              }
              value={formData.questionText}
              onChange={(e) =>
                setFormData((p) => ({ ...p, questionText: e.target.value }))
              }
              rows={isComprehensionOrCaseStudy ? 6 : 3}
              className="rounded-t-none"
            />
            <MathSymbolHint className="mt-1" />
            <MathPreview text={formData.questionText} />
            <QuestionImageUpload
              imageUrl={formData.imageUrl}
              onImageChange={(url) =>
                setFormData((p) => ({ ...p, imageUrl: url }))
              }
            />
          </div>

          {/* Matching pairs */}
          {isMatching && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Shuffle className="h-4 w-4" />
                  Match Pairs
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addMatchingPair}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Pair
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Column A</Label>
                  {formData.matchingColumnA.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <span className="w-6 text-center text-sm font-medium">
                        {idx + 1}.
                      </span>
                      <Input
                        placeholder={`Item ${idx + 1}`}
                        value={item}
                        onChange={(e) =>
                          updateMatchingColumn("A", idx, e.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    Column B (answers)
                  </Label>
                  {formData.matchingColumnB.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        placeholder={`Match for ${idx + 1}`}
                        value={item}
                        onChange={(e) =>
                          updateMatchingColumn("B", idx, e.target.value)
                        }
                      />
                      {formData.matchingColumnA.length > 2 && (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive shrink-0"
                          onClick={() => removeMatchingPair(idx)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Comprehension / Case-study sub-questions */}
          {isComprehensionOrCaseStudy && (
            <div className="space-y-4 p-4 bg-muted/50 rounded-lg border">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  {formData.questionType === "comprehension" ? (
                    <BookOpen className="h-4 w-4" />
                  ) : (
                    <Briefcase className="h-4 w-4" />
                  )}
                  Sub-Questions
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addSubQuestion}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Question
                </Button>
              </div>
              <div className="space-y-4">
                {formData.subQuestions.map((sq, idx) => (
                  <Card key={sq.id} className="bg-background">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <Label className="text-sm font-medium">
                          Q{idx + 1}
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            className="w-20 h-8"
                            value={sq.marks}
                            onChange={(e) =>
                              updateSubQuestion(
                                idx,
                                "marks",
                                parseInt(e.target.value) || 1
                              )
                            }
                          />
                          <span className="text-xs text-muted-foreground">
                            marks
                          </span>
                          {formData.subQuestions.length > 1 && (
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive"
                              onClick={() => removeSubQuestion(idx)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                      <Input
                        placeholder="Enter sub-question..."
                        value={sq.text}
                        onChange={(e) =>
                          updateSubQuestion(idx, "text", e.target.value)
                        }
                      />
                      <Textarea
                        placeholder="Expected answer (reference)..."
                        value={sq.answer}
                        onChange={(e) =>
                          updateSubQuestion(idx, "answer", e.target.value)
                        }
                        rows={2}
                        className="text-sm"
                      />
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <span className="text-sm text-muted-foreground">
                  Total:{" "}
                  {formData.subQuestions.reduce((s, sq) => s + sq.marks, 0)}{" "}
                  marks
                </span>
              </div>
            </div>
          )}

          {/* MCQ / True-False options */}
          {needsOptions && formData.options && (
            <div className="space-y-3">
              <Label>Options</Label>
              {formData.options.map((option, index) => (
                <div key={option.id} className="flex items-center gap-2">
                  <span className="w-6 text-center font-medium uppercase">
                    {option.id}
                  </span>
                  <Input
                    placeholder={`Option ${option.id.toUpperCase()}`}
                    value={option.text}
                    onChange={(e) => updateOption(index, e.target.value)}
                    disabled={formData.questionType === "true_false"}
                  />
                  {/* True/False options are fixed labels, so an image there
                      would have nothing to illustrate. */}
                  {formData.questionType !== "true_false" && (
                    <QuestionImageUpload
                      variant="thumb"
                      imageUrl={option.imageUrl ?? null}
                      onImageChange={(url) => updateOptionImage(index, url)}
                      ariaLabel={`option ${option.id.toUpperCase()}`}
                    />
                  )}
                </div>
              ))}
              <div className="space-y-2">
                <Label htmlFor="correct-answer">Correct Answer</Label>
                <Select
                  value={formData.correctAnswer || ""}
                  onValueChange={(v) =>
                    setFormData((p) => ({ ...p, correctAnswer: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select correct option" />
                  </SelectTrigger>
                  <SelectContent>
                    {formData.options.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        <span className="inline-flex items-center gap-1">
                          {option.id.toUpperCase()}:
                          {option.text ? (
                            <MathText as="span" text={option.text} />
                          ) : (
                            <span>(empty)</span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          {/* Fill-in-the-blank answer */}
          {isFillBlank && (
            <div className="space-y-2">
              <Label htmlFor="correct-answer">Correct Answer(s)</Label>
              <Input
                id="correct-answer"
                placeholder="For multiple blanks, comma-separate in order"
                value={formData.correctAnswer || ""}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, correctAnswer: e.target.value }))
                }
              />
            </div>
          )}

          <Separator />

          {/* Explanation */}
          <div className="space-y-2">
            <Label htmlFor="explanation">Explanation (shown after exam)</Label>
            <Textarea
              id="explanation"
              placeholder="Explain the answer..."
              value={formData.explanation || ""}
              onChange={(e) =>
                setFormData((p) => ({
                  ...p,
                  explanation: e.target.value || null,
                }))
              }
              rows={2}
            />
          </div>

          {/* Difficulty */}
          <div className="space-y-2">
            <Label>Difficulty Level</Label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5].map((level) => (
                <Button
                  key={level}
                  type="button"
                  size="sm"
                  variant={
                    formData.difficultyLevel === level ? "default" : "outline"
                  }
                  onClick={() =>
                    setFormData((p) => ({ ...p, difficultyLevel: level }))
                  }
                >
                  {level}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              1 = Easy, 5 = Very Hard
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={
                !formData.questionText.trim() ||
                !selectedChapterId ||
                (isMatching &&
                  formData.matchingColumnA.filter((a) => a.trim()).length < 2) ||
                (isComprehensionOrCaseStudy &&
                  formData.subQuestions.filter((sq) => sq.text.trim()).length ===
                    0)
              }
            >
              {editingQuestion ? "Update" : "Add"} Question
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
