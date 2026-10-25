import * as React from "react";
import { AlertCircle, BarChart3 } from "lucide-react";

import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface WidgetCardProps {
  title: string;
  /** Mandatory plain-language caption — what to look for in the chart. */
  caption: string;
  /** Optional visible "Tap any … to see …" affordance line. */
  clickHint?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  isEmpty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
  /** Right-aligned slot in the header — e.g. a class picker or window toggle. */
  headerSlot?: React.ReactNode;
  /** The chart. Rendered only in the success state. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Structural guarantee that every dashboard widget carries a caption + optional
 * click hint, and renders consistent loading / error / empty states. The caption
 * and hint render ONLY in the success state (alongside the chart), never over a
 * skeleton or empty illustration.
 */
export function WidgetCard({
  title,
  caption,
  clickHint,
  isLoading,
  isError,
  onRetry,
  isEmpty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  headerSlot,
  children,
  className,
}: WidgetCardProps) {
  return (
    <section className={cn("surface-card frosted-shadow rounded-card p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
        {headerSlot && <div className="shrink-0">{headerSlot}</div>}
      </div>

      <div className="mt-4">
        {isLoading ? (
          <Skeleton className="h-56 w-full rounded-card" />
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
            icon={<BarChart3 className="h-7 w-7" />}
            title={emptyTitle ?? "Nothing to show yet"}
            description={emptyDescription}
            action={emptyAction}
          />
        ) : (
          <>
            {children}
            <p className="mt-3 text-sm text-ink-600">{caption}</p>
            {clickHint && <p className="mt-1 text-xs text-ink-500">{clickHint}</p>}
          </>
        )}
      </div>
    </section>
  );
}
