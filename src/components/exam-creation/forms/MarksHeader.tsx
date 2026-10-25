import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface MarksHeaderProps {
  marks: number;
  defaultMarks: number;
  currentTotal?: number;
  targetTotal?: number;
  className?: string;
}

/**
 * Shows the marks-delta warning when a question's marks differ from the
 * section's default marks-per-question for that type group.
 */
export function MarksHeader({
  marks,
  defaultMarks,
  currentTotal,
  targetTotal,
  className,
}: MarksHeaderProps) {
  const overridden = Number(marks) !== Number(defaultMarks);
  if (!overridden) return null;

  const delta = Number(marks) - Number(defaultMarks);
  const newTotal =
    typeof currentTotal === "number" ? currentTotal + delta : undefined;

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border border-[#fa920e]/40 bg-[#fa920e]/10 px-3 py-2 text-xs text-[#8a4a00]",
        className
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#fa920e]" />
      <div>
        <div className="font-medium">
          Marks overridden ({defaultMarks} → {marks})
        </div>
        {typeof targetTotal === "number" && typeof newTotal === "number" && (
          <div className="text-[11px]">
            Section total will change from {targetTotal} to {newTotal}.
          </div>
        )}
      </div>
    </div>
  );
}
