import { format } from "date-fns";
import { Pin, PinOff, Layers, ChevronRight, Check, Clock, Lock, AlertCircle } from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces";
import {
  useScopedAttendanceClasses,
  usePinnedClassIds,
  useTogglePinClass,
  useAttendanceClassMarkers,
  formatMarkerNames,
  type ClassMarkStatus,
} from "@/hooks/useClassAttendance";
import { useEffectiveAttendanceSettings } from "@/hooks/useAttendance";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useAuth } from "@/hooks/useAuth";
import { formatClassName } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface ClassTileData {
  id: string;
  name: string;
  section: string | null;
}

function ClassTile({
  cls,
  pinned,
  status,
  statusFailed,
  currentUserId,
  onSelect,
  onTogglePin,
}: {
  cls: ClassTileData;
  pinned: boolean;
  status: ClassMarkStatus | undefined;
  /** The mark-status query failed; never let that read as "Pending". */
  statusFailed: boolean;
  currentUserId: string | undefined;
  onSelect: (classId: string) => void;
  onTogglePin: (classId: string, pinned: boolean) => void;
}) {
  const marked = !!status && status.total > 0;
  // Mirrors computeAttendanceLock: any record by someone else locks the day
  // for a teacher, whether or not they also wrote some rows themselves.
  const lockedByOther = !!status && status.markers.some((m) => m.id !== currentUserId);
  const markerLabel = status ? formatMarkerNames(status, currentUserId) : null;

  return (
    <button
      type="button"
      onClick={() => onSelect(cls.id)}
      className="group relative w-full text-left surface-card frosted-shadow rounded-card p-4 sm:p-5 transition-shadow hover:shadow-card-lg"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-brand-primary/10 text-brand-primary">
          <Layers className="h-5 w-5" />
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onTogglePin(cls.id, pinned);
          }}
          aria-label={pinned ? "Unpin class" : "Pin class"}
          className={cn(
            "rounded-full p-1.5 transition-colors",
            pinned ? "text-brand-primary hover:bg-brand-primary/10" : "text-ink-400 hover:text-ink-600 hover:bg-ink-400/10",
          )}
        >
          {pinned ? <Pin className="h-4 w-4 fill-brand-primary" /> : <PinOff className="h-4 w-4" />}
        </button>
      </div>

      <div className="mt-3 flex flex-col">
        <span className="text-base font-semibold text-ink-900 truncate">
          {formatClassName(cls.name, cls.section)}
        </span>
        <span className="mt-1 flex items-start gap-1 text-xs text-ink-500">
          {statusFailed ? (
            <>
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />
              <span className="min-w-0">Status unavailable</span>
            </>
          ) : marked ? (
            lockedByOther ? (
              <>
                <Lock className="mt-0.5 h-3 w-3 shrink-0" />
                <span className="min-w-0 break-words">{markerLabel}</span>
              </>
            ) : (
              <>
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" />
                <span className="min-w-0 break-words">{markerLabel}</span>
              </>
            )
          ) : (
            <>
              <Clock className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="min-w-0">Pending</span>
            </>
          )}
        </span>
      </div>

      <ChevronRight className="absolute right-4 bottom-4 h-4 w-4 text-ink-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

/**
 * Tile grid used in the "Mark Class" tab. Pinned classes appear first; the
 * rest follow in canonical class-name order. Each tile shows who marked the
 * class today ("Marked by you", "Marked by Priya Sharma") and a pin/unpin
 * toggle.
 */
export function ClassAttendanceTiles({
  onSelectClass,
}: {
  onSelectClass: (classId: string) => void;
}) {
  const { user } = useAuth();
  // Scoped: teacher → assigned, coordinator → wing, admin → institution-wide.
  const { data: classes, isLoading: classesLoading } = useScopedAttendanceClasses();
  const { data: pinned, isLoading: pinnedLoading } = usePinnedClassIds();
  const togglePin = useTogglePinClass();
  const classIds = (classes ?? []).map((c) => c.id);
  // Browser-local "today", consistent with the marker's date picker (fine for
  // India-only; the DB trigger is the institution-timezone authority).
  const today = format(new Date(), "yyyy-MM-dd");
  const { data: statusMap, error: statusError } = useAttendanceClassMarkers(classIds, today);

  const { data: roleInfo } = useUserRole();
  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  // Touch the settings hook so it's warm in the cache for downstream marker
  // edit-window calculations — no UI binding here.
  useEffectiveAttendanceSettings(institutionId);

  if (classesLoading || pinnedLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-32 rounded-card" />
        ))}
      </div>
    );
  }

  const all = classes ?? [];
  if (all.length === 0) {
    return (
      <EmptyState
        icon={<Layers className="h-7 w-7" />}
        title="No assigned classes"
        description="Once you're assigned to a class, it'll appear here for taking attendance."
      />
    );
  }

  const pinnedSet = pinned ?? new Set<string>();
  const pinnedList = all.filter((c) => pinnedSet.has(c.id));
  const restList = all.filter((c) => !pinnedSet.has(c.id));
  const statusFailed = !!statusError;

  const handleTogglePin = (classId: string, isPinned: boolean) => {
    togglePin.mutate({ classId, pinned: isPinned });
  };

  const renderTile = (c: ClassTileData, isPinned: boolean) => (
    <ClassTile
      key={c.id}
      cls={c}
      pinned={isPinned}
      status={statusMap?.get(c.id)}
      statusFailed={statusFailed}
      currentUserId={user?.id}
      onSelect={onSelectClass}
      onTogglePin={handleTogglePin}
    />
  );

  return (
    <div className="space-y-6">
      {statusFailed && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          Couldn't load today's marking status. You can still open a class to mark it.
        </p>
      )}

      {pinnedList.length > 0 && (
        <section>
          <p className="eyebrow mb-2">Pinned</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {pinnedList.map((c) => renderTile(c, true))}
          </div>
        </section>
      )}

      <section>
        <p className="eyebrow mb-2">{pinnedList.length > 0 ? "All classes" : "Your classes"}</p>
        {restList.length === 0 ? (
          <p className="text-sm text-ink-500">All your classes are pinned above.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {restList.map((c) => renderTile(c, false))}
          </div>
        )}
      </section>

      {/* Tiny helper text — surfaces the "click a tile to take attendance" affordance. */}
      <Button variant="ghost" size="sm" className="text-ink-500 pointer-events-none" tabIndex={-1}>
        Tap a class to mark today's attendance
      </Button>
    </div>
  );
}
