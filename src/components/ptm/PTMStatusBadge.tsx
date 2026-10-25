import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PTMEffectiveStatus } from "@/lib/ptm";

const STYLES: Record<PTMEffectiveStatus, { label: string; className: string; dot: string }> = {
  scheduled: {
    label: "Upcoming",
    className: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300",
    dot: "bg-sky-500",
  },
  active: {
    label: "Happening now",
    className: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/25 dark:text-emerald-300",
    dot: "bg-emerald-500",
  },
  completed: {
    label: "Completed",
    className: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
    dot: "bg-violet-500",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
    dot: "bg-rose-500",
  },
};

export function PTMStatusBadge({
  status,
  className,
}: {
  status: PTMEffectiveStatus;
  className?: string;
}) {
  const style = STYLES[status];
  return (
    <Badge
      variant="secondary"
      className={cn("shrink-0 gap-1.5 font-medium ring-1 ring-inset", style.className, className)}
    >
      <span className="relative flex h-1.5 w-1.5" aria-hidden="true">
        {status === "active" && (
          <span
            className={cn(
              "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:hidden",
              style.dot,
            )}
          />
        )}
        <span className={cn("relative inline-flex h-1.5 w-1.5 rounded-full", style.dot)} />
      </span>
      {style.label}
    </Badge>
  );
}
