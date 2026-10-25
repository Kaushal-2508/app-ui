import * as React from "react";
import { UserCog } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { useAssignableStaff } from "@/hooks/dashboard/useFlagActions";
import { cn } from "@/lib/utils";

export interface AssigneePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId?: string | null;
  /** Currently-assigned staff id (highlighted), if any. */
  currentAssigneeId?: string | null;
  /** Called with the chosen staff id; the sheet stays open so the caller can
   * close it on mutation success. */
  onSelect: (assigneeId: string) => void;
  /** Whether the reassign mutation is in flight (disables the rows). */
  loading?: boolean;
}

/**
 * "Give to someone else" picker — a bottom sheet listing the institution's
 * teachers + coordinators. Tapping a row fires `onSelect`; the caller owns the
 * reassign mutation + close-on-success. Built on `MobileSheet` (not a raw
 * Dialog) per §20b.
 */
export function AssigneePickerSheet({
  open,
  onOpenChange,
  institutionId,
  currentAssigneeId,
  onSelect,
  loading,
}: AssigneePickerSheetProps) {
  const { data: staff, isLoading } = useAssignableStaff(institutionId);

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Give this to someone else"
      subtitle="Pick a teacher or coordinator to own this task."
      icon={<UserCog className="h-4 w-4" />}
    >
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : !staff || staff.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-7 w-7" />}
          title="No staff to assign"
          description="Add teachers or coordinators to this school first."
        />
      ) : (
        <ul className="space-y-1">
          {staff.map((s) => {
            const isCurrent = s.id === currentAssigneeId;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onSelect(s.id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left text-sm transition-colors",
                    "hover:bg-brand-primary/5 disabled:opacity-60",
                    isCurrent && "bg-brand-primary/5",
                  )}
                >
                  <span className="min-w-0 truncate font-medium text-ink-900">{s.name}</span>
                  {isCurrent && (
                    <span className="shrink-0 text-xs font-medium text-brand-primary">Current</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </MobileSheet>
  );
}
