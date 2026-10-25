import { Check, X } from "lucide-react";
import { MathText } from "@/components/ui/math-text";
import type { ReviewQuestion } from "@/hooks/olympiad/useOlympiadReviewQuestions";

const OPTIONS: Array<"A" | "B" | "C" | "D"> = ["A", "B", "C", "D"];

type OptionKey = "option_a" | "option_b" | "option_c" | "option_d";

const OPTION_KEY_MAP: Record<string, OptionKey> = {
  A: "option_a",
  B: "option_b",
  C: "option_c",
  D: "option_d",
};

export function ReviewQuestionItem({ question }: { question: ReviewQuestion }) {
  const wasAttempted = question.selected_answer !== null;
  const wasCorrect =
    wasAttempted && question.selected_answer === question.correct_answer;
  const marksAwarded = wasCorrect ? question.marks : 0;

  return (
    <article className="surface-card frosted-shadow rounded-card p-5 space-y-3">
      <header className="flex items-center justify-between">
        <p className="eyebrow">Question {question.position}</p>
        <p className="text-xs font-mono text-ink-600">
          {marksAwarded} / {question.marks}
        </p>
      </header>

      <div>
        <MathText text={question.question_text} />
      </div>

      <ul className="space-y-2">
        {OPTIONS.map((letter) => {
          const optionKey = OPTION_KEY_MAP[letter];
          const isSelected = question.selected_answer === letter;
          const isCorrect = question.correct_answer === letter;
          const isWrongSelection = isSelected && !isCorrect;
          return (
            <li
              key={letter}
              className={`flex items-start gap-3 px-3 py-2 rounded-md border ${
                isCorrect
                  ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10"
                  : isWrongSelection
                    ? "border-red-300 bg-red-50 dark:bg-red-500/10"
                    : "border-surface-stroke"
              }`}
            >
              <span
                className={`mt-0.5 ${
                  isCorrect
                    ? "text-emerald-600"
                    : isWrongSelection
                      ? "text-red-600"
                      : "text-ink-500"
                }`}
              >
                {isCorrect ? (
                  <Check className="h-4 w-4" />
                ) : isWrongSelection ? (
                  <X className="h-4 w-4" />
                ) : (
                  <span className="w-4 inline-block" />
                )}
              </span>
              <span className="font-medium mr-1">{letter}.</span>
              <span className="flex-1">
                <MathText text={question[optionKey]} />
              </span>
            </li>
          );
        })}
      </ul>

      {!wasAttempted && (
        <p className="text-xs text-amber-700">
          You did not attempt this question.
        </p>
      )}
    </article>
  );
}
