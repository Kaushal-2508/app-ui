import * as React from "react";
import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardRealtimeStatus } from "@/hooks/dashboard/useDashboardRealtime";

export interface LastUpdatedIndicatorProps {
  status: DashboardRealtimeStatus;
  lastUpdatedAt: Date | null;
  onRetry: () => void;
  className?: string;
}

/** Human "N minutes ago" from a timestamp. Sub-minute reads as "just now". */
function formatRelative(from: Date, now: Date): string {
  const diffMs = now.getTime() - from.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  return `${minutes} minutes ago`;
}

/**
 * Connection-trust signal for the dashboard header (spec §5.3 / §7.1).
 * Healthy (`live`): normal-ink "Updated {rel}". Dropped (`reconnecting`): muted
 * gray "Updated {rel} — checking…" plus a small ghost retry button. The relative
 * time re-renders every minute via a self-cleaning interval (no leaked timers,
 * §23.2).
 */
export function LastUpdatedIndicator({
  status,
  lastUpdatedAt,
  onRetry,
  className,
}: LastUpdatedIndicatorProps) {
  // A ticking "now" so "N minutes ago" advances without a new data event.
  const [now, setNow] = React.useState(() => new Date());

  React.useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const isReconnecting = status === "reconnecting";
  const rel = lastUpdatedAt ? formatRelative(lastUpdatedAt, now) : null;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "text-xs",
          isReconnecting ? "text-ink-400" : "text-ink-500"
        )}
      >
        {rel === null
          ? "Updating…"
          : isReconnecting
            ? `Updated ${rel}, checking…`
            : `Updated ${rel}`}
      </span>
      {isReconnecting && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-ink-400 hover:text-ink-600"
          onClick={onRetry}
          aria-label="Retry connection"
          title="Retry connection"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}
