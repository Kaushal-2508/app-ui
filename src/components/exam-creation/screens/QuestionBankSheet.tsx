import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { QuestionBankSelector } from "@/components/exam/questions/QuestionBankSelector";
import type { ExamSection, ExamQuestion, QuestionType } from "@/types/exam";

interface QuestionBankSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: ExamSection | null;
  questionType: QuestionType | null;
  remaining: number;
  institutionId: string;
  classId: string;
  className?: string;
  subjectId: string;
  subjectName?: string;
  onAddQuestion: (
    sectionTempId: string,
    question: Omit<ExamQuestion, "tempId">
  ) => void;
}

/**
 * Bottom-sheet wrapper around QuestionBankSelector, pre-scoped to a single
 * section + question type with full exam context (class, subject, chapters).
 */
export function QuestionBankSheet({
  open,
  onOpenChange,
  section,
  questionType,
  remaining,
  institutionId,
  classId,
  className,
  subjectId,
  subjectName,
  onAddQuestion,
}: QuestionBankSheetProps) {
  if (!section || !questionType) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl sm:mx-auto"
      >
        <SheetHeader className="mb-3">
          <SheetTitle>Question Bank</SheetTitle>
        </SheetHeader>
        <QuestionBankSelector
          institutionId={institutionId}
          classId={classId}
          className={className}
          subjectId={subjectId}
          subjectName={subjectName}
          sectionChapterIds={section.chapterIds ?? []}
          questionType={questionType}
          remainingSlots={remaining}
          section={section}
          onAddQuestion={onAddQuestion}
          onComplete={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
