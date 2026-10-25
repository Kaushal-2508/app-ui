import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SuggestionAction = {
  label: string;
  onClick: () => void;
  icon?: React.ReactNode;
  variant?: "default" | "outline" | "destructive";
};

export type AiSuggestion = {
  /** Stable id per rule — keys the swap animation when the suggestion changes. */
  id: string;
  title: string;
  reason: string;
  /** Tasks already completed, shown as small check chips above the title. */
  done: string[];
  actions: SuggestionAction[];
};

/**
 * AI-style next-step suggestion for the Olympiad dashboard. Exactly ONE
 * recommendation at a time, derived from live data — as each task completes
 * (student enrolled, enrollment closed, schedule locked, …) the query-cache
 * invalidations re-evaluate the rules and the card advances to the next task,
 * animating the swap. Completed tasks accumulate as check chips so progress
 * stays visible.
 */
export function OlympiadAiSuggestionCard({
  suggestion,
  badge,
}: {
  suggestion: AiSuggestion;
  badge?: React.ReactNode;
}) {
  return (
    <section className="rounded-card bg-gradient-to-r from-brand-primary/50 via-brand-secondary/35 to-brand-primary/50 p-[1.5px] frosted-shadow">
      <div className="surface-card rounded-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <p className="eyebrow flex items-center gap-1.5">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-primary/10 text-brand-primary">
              <Sparkles className="h-3 w-3" />
            </span>
            AI suggestion
          </p>
          {badge}
        </div>
        {/* Keyed on the rule id: a new suggestion slides in when a task completes. */}
        <div key={suggestion.id} className="space-y-3 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
          {suggestion.done.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {suggestion.done.map((d) => (
                <span
                  key={d}
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                >
                  <Check className="h-3 w-3" /> {d}
                </span>
              ))}
            </div>
          )}
          <div>
            <h3 className="text-lg font-semibold text-ink-900">{suggestion.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{suggestion.reason}</p>
          </div>
          {suggestion.actions.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {suggestion.actions.map((a, i) => (
                <Button
                  key={a.label}
                  size="sm"
                  variant={a.variant ?? (i === 0 ? "default" : "outline")}
                  onClick={a.onClick}
                >
                  {a.icon}
                  {a.label}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
