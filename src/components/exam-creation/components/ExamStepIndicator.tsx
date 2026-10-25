import { cn } from "@/lib/utils";

export type ExamWizardStep = "details" | "questions" | "review";

const STEPS: Array<{ key: ExamWizardStep; label: string }> = [
  { key: "details", label: "Details" },
  { key: "questions", label: "Questions" },
  { key: "review", label: "Review" },
];

interface ExamStepIndicatorProps {
  current: ExamWizardStep;
  /**
   * Steps the teacher may jump to. A step is omitted while its prerequisites
   * are missing (e.g. Review before any question exists), so the indicator can
   * never strand someone on a screen that has nothing to show.
   */
  reachable: ExamWizardStep[];
  onNavigate: (step: ExamWizardStep) => void;
  className?: string;
}

/**
 * The "1 Details · 2 Questions · 3 Review" header strip, shared by all three
 * exam-creation screens (it used to be copy-pasted as inert <span>s in each).
 * Reachable steps are real buttons so a teacher resuming a draft can jump
 * straight back to the part they want instead of clicking Continue through
 * screens they already finished.
 */
export function ExamStepIndicator({
  current,
  reachable,
  onNavigate,
  className,
}: ExamStepIndicatorProps) {
  return (
    <div
      className={cn(
        "hidden md:flex items-center gap-2 text-xs text-muted-foreground",
        className,
      )}
    >
      {STEPS.map((step, i) => {
        const isCurrent = step.key === current;
        const canGo = !isCurrent && reachable.includes(step.key);
        return (
          <div key={step.key} className="flex items-center gap-2">
            {i > 0 && <span className="text-border">·</span>}
            <button
              type="button"
              disabled={!canGo}
              onClick={() => canGo && onNavigate(step.key)}
              aria-current={isCurrent ? "step" : undefined}
              title={
                isCurrent
                  ? `You're on ${step.label}`
                  : canGo
                    ? `Go to ${step.label}`
                    : `${step.label} isn't ready yet`
              }
              className={cn(
                "flex items-center gap-2 rounded-full transition-colors",
                canGo && "cursor-pointer hover:text-foreground",
                !canGo && !isCurrent && "cursor-not-allowed opacity-60",
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px]",
                  isCurrent
                    ? "bg-primary text-primary-foreground font-bold"
                    : "border border-border font-medium",
                  canGo && "hover:border-primary/60",
                )}
              >
                {i + 1}
              </span>
              <span className={cn(isCurrent && "font-semibold text-foreground")}>
                {step.label}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}