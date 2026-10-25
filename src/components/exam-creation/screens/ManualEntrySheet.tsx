import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ContextStrip } from "../components/ContextStrip";
import { formForType } from "../forms";
import type { ExamQuestion, QuestionType, ExamSection } from "@/types/exam";

interface ManualEntrySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  section: ExamSection | null;
  questionType: QuestionType | null;
  remaining: number;
  onAddQuestion: (sectionTempId: string, question: ExamQuestion) => void;
  /** When set, the sheet opens in edit mode with pre-filled values. */
  editingQuestion?: ExamQuestion | null;
  /** Called instead of onAddQuestion when editing an existing question. */
  onUpdateQuestion?: (sectionTempId: string, questionTempId: string, updates: Partial<ExamQuestion>) => void;
}

export function ManualEntrySheet({
  open,
  onOpenChange,
  section,
  questionType,
  remaining,
  onAddQuestion,
  editingQuestion,
  onUpdateQuestion,
}: ManualEntrySheetProps) {
  if (!section || !questionType) return null;

  const Form = formForType(questionType);
  const defaultMarks =
    section.questionTypeMarks?.[questionType] ?? section.defaultMarks ?? 1;

  // Current + target totals for the warning strip
  const currentTotal = section.questions.reduce(
    (sum, q) => sum + (q.marks ?? 0),
    0
  );
  const targetTotal = Object.entries(section.questionTypeCounts || {}).reduce(
    (sum, [type, count]) =>
      sum + count * (section.questionTypeMarks?.[type] ?? 1),
    0
  );

  const isEditing = !!editingQuestion;
  // Block new-question adds when the section is already full. Editing an
  // existing question is always allowed (it doesn't consume a new slot).
  const isFull = !isEditing && remaining <= 0;

  const handleSave = (q: ExamQuestion, closeAfter: boolean) => {
    if (isEditing && onUpdateQuestion && editingQuestion) {
      onUpdateQuestion(section.tempId, editingQuestion.tempId, q);
      onOpenChange(false);
    } else {
      onAddQuestion(section.tempId, q);
      if (closeAfter) onOpenChange(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto sm:max-w-xl sm:mx-auto"
      >
        <SheetHeader className="mb-3">
          <SheetTitle>{isEditing ? "Edit question" : "Manual entry"}</SheetTitle>
        </SheetHeader>
        <ContextStrip
          sectionTitle={section.title}
          typeLabel={String(questionType)}
          remaining={remaining}
          className="mb-3"
        />
        {isFull ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <div className="flex items-start gap-2.5">
              <AlertCircle className="h-5 w-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-semibold text-destructive">
                  This section is full.
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Remove a question to add a different one.
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        ) : (
          <Form
            key={editingQuestion?.tempId ?? "new"}
            questionType={questionType}
            defaultMarks={defaultMarks}
            sectionCurrentTotal={currentTotal}
            sectionTargetTotal={targetTotal}
            initial={editingQuestion ?? undefined}
            onSaveDone={(q) => handleSave(q, true)}
            onSaveAnother={(q) => handleSave(q, false)}
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
