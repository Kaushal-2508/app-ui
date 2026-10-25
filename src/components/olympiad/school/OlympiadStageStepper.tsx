import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OlympiadStage } from "./olympiadStage";

export type { OlympiadStage } from "./olympiadStage";

const STEPS: { n: OlympiadStage; label: string }[] = [
  { n: 1, label: "Enroll" },
  { n: 2, label: "Schedule" },
  { n: 3, label: "Exam day" },
  { n: 4, label: "Results" },
];

/**
 * Four-step journey indicator for the school-admin Olympiad flow:
 * Enroll → Schedule → Exam day → Results. Completed steps show a check,
 * the current step is highlighted, future steps are muted.
 */
export function OlympiadStageStepper({ stage }: { stage: OlympiadStage }) {
  return (
    <ol className="flex items-start" aria-label="Olympiad progress">
      {STEPS.map((s, i) => {
        const done = stage > s.n;
        const current = stage === s.n;
        return (
          <li
            key={s.n}
            className={cn("flex items-start", i < STEPS.length - 1 && "flex-1")}
          >
            <div className="flex min-w-[64px] flex-col items-center gap-1.5">
              <span
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors",
                  done && "border-brand-primary bg-brand-primary text-white",
                  current && "border-brand-primary bg-brand-primary/10 text-brand-primary",
                  !done && !current && "border-surface-stroke bg-surface-card text-ink-400",
                )}
              >
                {done ? <Check className="h-4 w-4" /> : s.n}
              </span>
              <span
                className={cn(
                  "text-[11px] font-medium",
                  current ? "text-brand-primary" : done ? "text-ink-700" : "text-ink-400",
                )}
              >
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  "mt-4 h-0.5 flex-1 rounded-full",
                  done ? "bg-brand-primary" : "bg-surface-stroke",
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
