import { format } from "date-fns";
import { AlertTriangle, LifeBuoy, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useBackfillSupportMirrors, useSupportHealth } from "@/hooks/useSupportHealth";

/**
 * Operator banner for the Support Inbox. Silent when intake is healthy.
 *
 * Exists because of the 2026-09-02 incident: the SALCI Support container
 * institution was deleted during a cleanup, every submission failed for seven
 * days, and this page looked like a quiet week. Now a failed or degraded
 * intake shows up here, with the recovery action next to it.
 */
export function SupportHealthBanner() {
  const { data, isLoading, isError, error, refetch } = useSupportHealth();
  const backfill = useBackfillSupportMirrors();

  if (isLoading) return null;

  // Error before empty (CLAUDE.md section 6): a failed health read must not
  // pass as "healthy".
  if (isError) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-card border border-surface-stroke bg-surface-card px-4 py-3 text-sm text-ink-600">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <span>Couldn't check support intake health.</span>
        {error instanceof Error && <span className="truncate text-ink-500">{error.message}</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  if (!data || data.status === "ok") return null;

  const down = data.status === "down";
  const orphans = data.open_tickets_without_task;

  const reasons: string[] = [];
  if (!data.institution_ok) {
    reasons.push("The SALCI Support container is missing. It is re-created automatically on the next request.");
  }
  if (!data.owner_ok) {
    reasons.push("No support owner is configured. New requests are routed to every super admin.");
  }
  if (data.failures_24h > 0) {
    reasons.push(
      `${data.failures_24h} submission${data.failures_24h === 1 ? "" : "s"} failed in the last 24 hours.`,
    );
  }
  if (data.degraded_7d > 0) {
    reasons.push(`${data.degraded_7d} degraded event${data.degraded_7d === 1 ? "" : "s"} this week.`);
  }
  if (orphans > 0) {
    reasons.push(
      `${orphans} open request${orphans === 1 ? " has" : "s have"} no task in the Tasks tab.`,
    );
  }

  return (
    <div
      className={cn(
        "mt-4 rounded-card border p-4",
        down ? "border-rose-500/30 bg-rose-500/10" : "border-amber-500/30 bg-amber-500/10",
      )}
      role="status"
    >
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle
          className={cn("mt-0.5 h-5 w-5 shrink-0", down ? "text-rose-600" : "text-amber-600")}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold text-ink-900">
            {down ? "Support intake is down" : "Support intake is degraded"}
          </p>
          <ul className="list-disc space-y-0.5 pl-4 text-sm text-ink-700">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          {data.last_intake_at && (
            <p className="text-xs text-ink-500">
              Last request received {format(new Date(data.last_intake_at), "PPp")}.
            </p>
          )}
          {data.recent_events.length > 0 && (
            <div className="mt-2 space-y-0.5">
              <p className="eyebrow">Recent events</p>
              {data.recent_events.slice(0, 3).map((event, index) => (
                <p key={`${event.at}-${index}`} className="truncate text-xs text-ink-600">
                  <span className="font-medium">{event.kind}</span>
                  {event.detail ? `: ${event.detail}` : ""}
                  <span className="text-ink-500"> ({format(new Date(event.at), "MMM d, HH:mm")})</span>
                </p>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          {orphans > 0 && (
            <Button
              size="sm"
              onClick={() => backfill.mutate()}
              disabled={backfill.isPending}
              className="bg-brand-primary text-white hover:bg-brand-primary/90"
            >
              <LifeBuoy className="mr-1.5 h-4 w-4" />
              {backfill.isPending ? "Re-linking..." : "Re-link to tasks"}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Re-check
          </Button>
        </div>
      </div>
    </div>
  );
}
