import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { MathText } from "@/components/ui/math-text";
import { Search, Plus, Loader2, Library } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuestionBank } from "@/hooks/useQuestionBank";
import { useChaptersForExam } from "@/hooks/useChaptersForExam";
import { useChapterTopics } from "@/hooks/useChapterTopics";
import type {
  ExamSection,
  ExamQuestion,
  QuestionType,
  QuestionOption,
} from "@/types/exam";
import { toDbQuestionType } from "@/types/exam";

interface QuestionBankSelectorProps {
  institutionId: string;
  classId: string;
  className?: string;
  subjectId: string;
  subjectName?: string;
  sectionChapterIds: string[];
  questionType: QuestionType;
  remainingSlots: number;
  section: ExamSection;
  onAddQuestion: (
    sectionTempId: string,
    question: Omit<ExamQuestion, "tempId">
  ) => void;
  onComplete?: () => void;
}

/**
 * Context-aware question bank selector. Pre-scoped to a single section +
 * question type, with class/subject locked to the exam's context and
 * chapter/topic scoped to the section's selected chapters.
 */
export function QuestionBankSelector({
  institutionId,
  classId,
  className,
  subjectId,
  subjectName,
  sectionChapterIds,
  questionType,
  remainingSlots,
  section,
  onAddQuestion,
  onComplete,
}: QuestionBankSelectorProps) {
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [selectedChapterId, setSelectedChapterId] = useState<string>(
    sectionChapterIds[0] ?? ""
  );
  const [selectedTopicId, setSelectedTopicId] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Resolve chapter names from useChaptersForExam, filtered to section's chapters
  const { data: allChapters } = useChaptersForExam({ classId, subjectId });
  const chapters = useMemo(
    () =>
      (allChapters ?? []).filter((c) => sectionChapterIds.includes(c.id)),
    [allChapters, sectionChapterIds]
  );

  // Single-chapter sections: lock the filter to that chapter
  const isSingleChapter = sectionChapterIds.length === 1;
  const selectedChapter = chapters.find((c) => c.id === selectedChapterId);

  // Reset topic when chapter changes
  useEffect(() => {
    setSelectedTopicId("all");
  }, [selectedChapterId]);

  // Topics for the currently selected chapter
  const { data: topics = [] } = useChapterTopics({
    institutionId,
    classId,
    subjectId,
    chapterId: selectedChapterId || undefined,
  });

  // Fetch bank questions with full context filters
  const dbQuestionType = toDbQuestionType(questionType);
  const { data: bankResult, isLoading } = useQuestionBank({
    institutionId,
    subjectId,
    topicId: selectedChapterId || undefined,
    chapterTopicId: selectedTopicId !== "all" ? selectedTopicId : undefined,
    questionType: dbQuestionType,
    search: searchQuery || undefined,
    excludeSubQuestions: true,
    pageSize: 50,
  });

  const questions = bankResult?.data ?? [];

  // Apply difficulty filter client-side (hook doesn't expose it)
  const visibleQuestions = useMemo(() => {
    if (difficultyFilter === "all") return questions;
    const level = parseInt(difficultyFilter);
    return questions.filter((q) => q.difficulty_level === level);
  }, [questions, difficultyFilter]);

  const slotsUsed = selectedIds.size;
  const slotsLeft = Math.max(0, remainingSlots - slotsUsed);
  const isFull = slotsLeft === 0;

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < remainingSlots) {
        next.add(id);
      }
      return next;
    });
  };

  const handleAdd = () => {
    if (selectedIds.size === 0) return;
    const picks = visibleQuestions.filter((q) => selectedIds.has(q.id));

    picks.forEach((q) => {
      const parsedOptions = Array.isArray(q.options)
        ? (q.options as unknown as QuestionOption[])
        : null;

      let matchingData:
        | { columnA: string[]; columnB: string[]; matches?: string }
        | undefined;
      if (
        q.question_type === "matching" &&
        q.options &&
        typeof q.options === "object" &&
        !Array.isArray(q.options)
      ) {
        const o = q.options as Record<string, unknown>;
        if (Array.isArray(o.columnA) && Array.isArray(o.columnB)) {
          matchingData = {
            columnA: o.columnA as string[],
            columnB: o.columnB as string[],
          };
        }
      }

      const examQuestion: Omit<ExamQuestion, "tempId"> = {
        questionText: q.question_text,
        questionType: q.question_type as QuestionType,
        marks: section.defaultMarks || q.marks || 1,
        negativeMarks: section.negativeMarking || 0,
        options: q.question_type === "matching" ? null : parsedOptions,
        correctAnswer: q.correct_answer,
        explanation: q.explanation,
        difficultyLevel: q.difficulty_level || 2,
        tags: q.tags || [],
        matchingData,
        // Bank rows can carry a diagram — without this the figure is dropped
        // the moment the question is pulled into an exam.
        imageUrl: q.image_url ?? undefined,
      };
      onAddQuestion(section.tempId, examQuestion);
    });

    toast({
      title: "Questions added",
      description: `${picks.length} question${picks.length > 1 ? "s" : ""} added to ${section.title}`,
    });
    setSelectedIds(new Set());
    onComplete?.();
  };

  const chapterLabel = (c: { topicName: string; chapterNumber: number | null }) =>
    c.chapterNumber ? `Ch ${c.chapterNumber}: ${c.topicName}` : c.topicName;

  return (
    <div className="space-y-4">
      {/* Remaining slots indicator */}
      <div
        className={`rounded-lg border px-4 py-3 text-sm ${
          isFull
            ? "border-destructive/40 bg-destructive/5"
            : "border-primary/30 bg-primary/5"
        }`}
      >
        <div className="flex items-center justify-between">
          <div>
            You can add up to{" "}
            <span className="font-semibold text-foreground">
              {remainingSlots}
            </span>{" "}
            more question{remainingSlots !== 1 ? "s" : ""} to this section.
          </div>
          <Badge variant={isFull ? "destructive" : "secondary"}>
            {slotsUsed} / {remainingSlots} selected
          </Badge>
        </div>
      </div>

      {/* Read-only context */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Class</Label>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {className || "N/A"}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Subject</Label>
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
            {subjectName || "N/A"}
          </div>
        </div>
      </div>

      {/* Chapter: read-only if single, dropdown if multiple */}
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Chapter</Label>
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

      {/* Topic dropdown — only when topics exist */}
      {topics.length > 0 && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Topic</Label>
          <Select value={selectedTopicId} onValueChange={setSelectedTopicId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All topics</SelectItem>
              {topics.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Search + difficulty */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search questions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Difficulty</Label>
          <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All levels</SelectItem>
              <SelectItem value="1">Level 1 (Easy)</SelectItem>
              <SelectItem value="2">Level 2</SelectItem>
              <SelectItem value="3">Level 3 (Medium)</SelectItem>
              <SelectItem value="4">Level 4</SelectItem>
              <SelectItem value="5">Level 5 (Hard)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Results */}
      <div>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : visibleQuestions.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            <Library className="mx-auto mb-2 h-8 w-8 opacity-50" />
            No matching questions in the bank.
          </div>
        ) : (
          <div className="max-h-96 space-y-2 overflow-y-auto">
            {visibleQuestions.map((q) => {
              const checked = selectedIds.has(q.id);
              const disabled = !checked && isFull;
              return (
                <Card
                  key={q.id}
                  className={checked ? "border-primary bg-primary/5" : ""}
                >
                  <CardContent className="flex items-start gap-3 p-3">
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={() => toggle(q.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <MathText
                        as="p"
                        className="text-sm line-clamp-2"
                        text={q.question_text}
                      />
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="outline" className="text-xs">
                          {q.question_type.replace("_", " ")}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {section.defaultMarks || q.marks || 1} marks
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          Lvl {q.difficulty_level || 2}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {selectedIds.size > 0 && (
        <Button onClick={handleAdd} className="w-full">
          <Plus className="mr-2 h-4 w-4" />
          Add {selectedIds.size} question{selectedIds.size > 1 ? "s" : ""} to{" "}
          {section.title}
        </Button>
      )}
    </div>
  );
}
