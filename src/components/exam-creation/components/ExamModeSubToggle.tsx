import { cn } from "@/lib/utils";

interface ExamModeSubToggleProps {
  value: boolean; // true = "Already Created" (results-only)
  onChange: (isResultsOnly: boolean) => void;
}

const OPTIONS: { key: boolean; label: string; hint: string }[] = [
  { key: false, label: "Create Exam", hint: "Build sections & questions" },
  { key: true, label: "Already Created", hint: "Upload results of a past paper" },
];

/** Sub-toggle shown under the mode buttons when Offline is selected. */
export function ExamModeSubToggle({ value, onChange }: ExamModeSubToggleProps) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {OPTIONS.map((opt) => (
        <button
          key={String(opt.key)}
          type="button"
          onClick={() => onChange(opt.key)}
          aria-pressed={value === opt.key}
          className={cn(
            "min-h-[48px] rounded-lg border px-3 py-2 text-left transition-all duration-200",
            value === opt.key
              ? "border-primary bg-primary/10 text-foreground shadow-sm"
              : "border-border bg-background text-foreground hover:bg-muted hover:border-primary/30",
          )}
        >
          <div className="text-sm font-medium">{opt.label}</div>
          <div className="text-[11px] text-muted-foreground">{opt.hint}</div>
        </button>
      ))}
    </div>
  );
}
