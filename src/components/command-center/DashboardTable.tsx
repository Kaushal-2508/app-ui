import * as React from "react";
import { AlertCircle, Inbox } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export interface DashboardTableProps {
  title: string;
  /** Plain-language line above the list — what this table is for. */
  description: string;
  /** Slot for FilterRow / FilterChip / FilterSheet trigger. */
  filterSlot?: React.ReactNode;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
  /** Total rows the RPC reports (for the "Show all (N)" affordance). */
  total: number;
  /** Rows currently rendered. */
  shown: number;
  onToggleShowAll?: () => void;
  showingAll?: boolean;
  /** The ListRow list. Rendered only in the success state. */
  children: React.ReactNode;
}

/**
 * Wrapper for the four drill-down tables: above-table description, filter slot,
 * consistent loading / error / empty states, and a "Show all (N)" / "Show less"
 * footer toggle. The list itself (ListRow rows) is passed as children.
 */
export function DashboardTable({
  title,
  description,
  filterSlot,
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  total,
  shown,
  onToggleShowAll,
  showingAll,
  children,
}: DashboardTableProps) {
  const canToggle = onToggleShowAll && (showingAll || total > shown);

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink-900">{title}</h2>
        <p className="text-sm text-ink-600">{description}</p>
      </div>

      {filterSlot && <div className="mt-3">{filterSlot}</div>}

      <div className="mt-4">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-card" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 px-4 text-center">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertCircle className="h-6 w-6" />
            </span>
            <p className="text-sm text-ink-600">Couldn't load this right now.</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                Try again
              </Button>
            )}
          </div>
        ) : isEmpty ? (
          <EmptyState
            icon={<Inbox className="h-7 w-7" />}
            title={emptyTitle ?? "Nothing here yet"}
            description={emptyDescription}
            action={emptyAction}
          />
        ) : (
          children
        )}
      </div>

      {!isLoading && !isError && !isEmpty && canToggle && (
        <div className="mt-3">
          <Button variant="ghost" className="w-full" onClick={onToggleShowAll}>
            {showingAll ? "Show less" : `Show all (${total})`}
          </Button>
        </div>
      )}
    </section>
  );
}
