import { useState } from "react";
import { Flag, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MathText } from "@/components/ui/math-text";
import type { AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";

type Props = {
  question: AttemptQuestion;
  onAnswerChange: (answer: "A" | "B" | "C" | "D" | null, marked: boolean) => void;
  onPrev?: () => void;
  onNext?: () => void;
  /** Opens the submit-confirm flow. Shown in place of "Save & Next" on the last question. */
  onSubmit?: () => void;
};

const OPTIONS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

export function QuestionDisplay({ question, onAnswerChange, onPrev, onNext, onSubmit }: Props) {
  const [marked, setMarked] = useState(question.marked_for_review);

  return (
    <div className="space-y-5">
      <header className="flex items-center justify-between">
        <p className="eyebrow">Question {question.position}</p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = !marked;
            setMarked(next);
            onAnswerChange(question.selected_answer, next);
          }}
          className={marked ? "text-amber-600" : ""}
        >
          <Flag className="h-4 w-4 mr-1" />
          {marked ? "Marked" : "Mark for review"}
        </Button>
      </header>

      <div className="surface-card frosted-shadow rounded-card p-5">
        <MathText text={question.question_text} />
      </div>

      <fieldset className="space-y-2">
        <legend className="sr-only">Select an option</legend>
        {OPTIONS.map((letter) => {
          const optionKey = `option_${letter.toLowerCase()}` as keyof AttemptQuestion;
          const isSelected = question.selected_answer === letter;
          return (
            <label
              key={letter}
              className={`flex items-start gap-3 px-4 py-3 rounded-md border cursor-pointer transition-colors ${
                isSelected
                  ? "border-brand-primary bg-brand-primary/5"
                  : "border-surface-stroke hover:bg-surface-card/50"
              }`}
            >
              <input
                type="radio"
                name={`q-${question.snapshot_id}`}
                value={letter}
                checked={isSelected}
                onChange={() => onAnswerChange(letter, marked)}
                className="mt-1"
              />
              <div className="flex-1">
                <span className="font-medium mr-2">{letter}.</span>
                <MathText text={question[optionKey] as string} />
              </div>
            </label>
          );
        })}
      </fieldset>

      <div className="flex justify-between gap-2 pt-4">
        <Button variant="outline" onClick={onPrev} disabled={!onPrev}>
          Previous
        </Button>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            onClick={() => onAnswerChange(null, marked)}
            disabled={question.selected_answer === null}
          >
            Clear
          </Button>
          {onNext ? (
            <Button onClick={onNext}>Save & Next</Button>
          ) : (
            <Button onClick={onSubmit} disabled={!onSubmit}>
              <Send className="h-4 w-4 mr-1" />
              Submit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
