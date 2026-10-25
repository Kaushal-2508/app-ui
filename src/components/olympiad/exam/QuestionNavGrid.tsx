import type { AttemptQuestion } from "@/hooks/olympiad/useOlympiadAttemptQuestions";

type Props = {
  questions: AttemptQuestion[];
  activePosition: number;
  onSelect: (position: number) => void;
};

export function QuestionNavGrid({ questions, activePosition, onSelect }: Props) {
  return (
    <div className="grid grid-cols-5 gap-2">
      {questions.map((q) => {
        const isActive = q.position === activePosition;
        const isAnswered = q.selected_answer !== null;
        const isFlagged = q.marked_for_review;
        return (
          <button
            key={q.snapshot_id}
            onClick={() => onSelect(q.position)}
            aria-current={isActive ? "true" : undefined}
            className={`aspect-square rounded-md text-sm font-medium transition-colors border ${
              isActive ? "ring-2 ring-brand-primary border-brand-primary" : "border-surface-stroke"
            } ${
              isAnswered && isFlagged
                ? "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300"
                : isAnswered
                ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300"
                : isFlagged
                ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                : "bg-surface-card text-ink-700"
            }`}
          >
            {q.position}
          </button>
        );
      })}
    </div>
  );
}
