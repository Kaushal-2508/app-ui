import { useEffect, useMemo, useRef, useState } from "react";
import { Split } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { Input } from "@/components/ui/input";
import {
  useSplitWingTarget,
  useWingTeachers,
  type TeacherTargetRow,
} from "@/hooks/useTeacherTargets";
import { cn } from "@/lib/utils";

export interface SplitPoolSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The scope='wing' target being shared out. */
  pool: TeacherTargetRow;
  /** This pool's existing children (scope='teacher', parent_target_id === pool.id)
   *  from the already-loaded overview, used to prefill each teacher's current
   *  share. tgt_split_wing_target replaces the whole allocation wholesale, so
   *  without a prefill, saving after touching only one field would silently
   *  drop every other teacher who wasn't re-entered. */
  existingChildren: TeacherTargetRow[];
}

export function SplitPoolSheet({ open, onOpenChange, pool, existingChildren }: SplitPoolSheetProps) {
  // tgt_wing_teachers resolves the wing through its ACTIVE classes and their
  // teacher assignments. Do not swap this back to useWingMembers: that reads
  // wing_assignments, which holds the wing's coordinators rather than its
  // teachers, and whose RLS shows a coordinator only their own row.
  const { data: wingTeachers, isLoading: teachersLoading, error: teachersError } = useWingTeachers(
    pool.wing_id,
  );
  const candidates = useMemo(() => wingTeachers ?? [], [wingTeachers]);
  const existingByTeacher = useMemo(() => {
    const map = new Map<string, number>();
    existingChildren.forEach((c) => map.set(c.owner_id, c.target_value));
    return map;
  }, [existingChildren]);

  const [values, setValues] = useState<Record<string, string>>({});
  const seededForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      seededForRef.current = null;
      return;
    }
    if (!wingTeachers) return; // wait for the candidate list before seeding
    if (seededForRef.current === pool.id) return; // already seeded this open session
    seededForRef.current = pool.id;
    const seeded: Record<string, string> = {};
    candidates.forEach((c) => {
      const existing = existingByTeacher.get(c.id);
      if (existing) seeded[c.id] = String(existing);
    });
    setValues(seeded);
  }, [open, pool.id, wingTeachers, candidates, existingByTeacher]);

  const total = candidates.reduce((sum, c) => {
    const v = Number(values[c.id]);
    return sum + (Number.isFinite(v) && v > 0 ? v : 0);
  }, 0);
  const gap = pool.target_value - total;

  const splitMutation = useSplitWingTarget();

  const handleSave = () => {
    const allocations = candidates
      .map((c) => ({ teacher_id: c.id, value: Number(values[c.id]) }))
      .filter((a) => Number.isFinite(a.value) && a.value > 0);
    splitMutation.mutate(
      { parentId: pool.id, allocations },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={`Share out ${pool.wing_name ?? "this pool"}`}
      subtitle={`${pool.target_value} to allocate across this wing's teachers`}
      icon={<Split className="h-4 w-4" />}
      desktopWidth="md"
      // Decision 14: an allocation that does not add up to the pool is
      // ALLOWED. The button stays enabled and the toast reports the gap;
      // never block this save on the total matching.
      primaryAction={{ label: "Save split", onClick: handleSave, loading: splitMutation.isPending }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-4">
        <div
          className={cn(
            "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium",
            gap === 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700",
          )}
        >
          <span>{total} of {pool.target_value} allocated</span>
          {gap !== 0 && <span>{gap > 0 ? `${gap} left to give out` : `${-gap} over the pool`}</span>}
        </div>

        {/* Error before empty (CLAUDE.md 6): a failed lookup must never read as
            "this wing has no teachers". */}
        {teachersError ? (
          <p className="text-sm text-destructive">
            Couldn't load this wing's teachers. Close this and try again.
          </p>
        ) : teachersLoading ? (
          <p className="text-sm text-ink-500">Loading this wing's teachers...</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-ink-500">
            No teachers are assigned to the classes in this wing yet.
          </p>
        ) : (
          <div className="space-y-2">
            {candidates.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{c.full_name}</span>
                <Input
                  type="number"
                  min={0}
                  placeholder="0"
                  value={values[c.id] ?? ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [c.id]: e.target.value }))}
                  className="h-9 w-24 text-right"
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-ink-500">
          Leaving a box empty removes that teacher's share when you save.
        </p>
      </div>
    </MobileSheet>
  );
}
