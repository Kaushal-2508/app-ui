import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AIGenerateQuestions } from "@/components/exam/questions/AIGenerateQuestions";
import type { ExamSection, ExamQuestion, QuestionType } from "@/types/exam";

interface AIGenerateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: ExamSection | null;
  questionType: QuestionType | null;
  remaining: number;
  classId: string;
  subjectId: string;
  subjectName?: string;
  institutionId: string;
  onAddQuestion: (
    sectionTempId: string,
    question: Omit<ExamQuestion, "tempId">
  ) => void;
}

/**
 * Bottom-sheet wrapper around AIGenerateQuestions, pre-scoped to a single
 * section + question type so the teacher only sees the AI controls relevant
 * to the group they're filling.
 */
export function AIGenerateSheet({
  open,
  onOpenChange,
  section,
  questionType,
  remaining,
  classId,
  subjectId,
  subjectName,
  institutionId,
  onAddQuestion,
}: AIGenerateSheetProps) {
  if (!section || !questionType) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl sm:mx-auto"
      >
        <SheetHeader className="mb-3">
          <SheetTitle>AI Generate</SheetTitle>
        </SheetHeader>
        <AIGenerateQuestions
          section={section}
          questionType={questionType}
          remainingSlots={remaining}
          classId={classId}
          subjectId={subjectId}
          subjectName={subjectName}
          institutionId={institutionId}
          onAddQuestion={onAddQuestion}
          onComplete={() => onOpenChange(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
