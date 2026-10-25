import { cn } from "@/lib/utils";

interface CompletionBarProps {
  percent: number; // 0..100
  className?: string;
}

/**
 * Colored completion bar — green ≥100%, amber 60–99%, red <60%.
 * Matches SALCI design tokens (primary = #249ca2).
 */
export function CompletionBar({ percent, className }: CompletionBarProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const colorClass =
    clamped >= 100
      ? "bg-emerald-500"
      : clamped >= 60
      ? "bg-[#249ca2]"
      : "bg-[#249ca2]/60";

  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full rounded-full bg-muted overflow-hidden", className)}
    >
      <div
        className={cn("h-full transition-all duration-300 rounded-full", colorClass)}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
