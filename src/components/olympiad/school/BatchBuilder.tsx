import { useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Loader2, Plus, Wand2, Users, Monitor, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadBatchingRoster } from "@/hooks/olympiad/useOlympiadBatchingRoster";
import { useLockBatchSchedule, type LockBatch } from "@/hooks/olympiad/useLockBatchSchedule";
import { useOlympiadCampaigns } from "@/hooks/olympiad/useOlympiadCampaign";
import type { MyOlympiadSchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { LockScheduleDialog } from "./LockScheduleDialog";
import { BatchBuilderCard } from "./BatchBuilderCard";
import { RemainingPanel } from "./RemainingPanel";
import {
  addClassToBatch,
  allSeated,
  autoFill,
  batchGradeLevelId,
  batchLabel,
  batchStudentIds,
  remainingByClass,
  removeAllocation,
  type BuilderBatch,
} from "@/lib/olympiad/batchSeating";

let _seq = 0;
const newId = () => `b-${_seq++}`;

export function BatchBuilder({ school }: { school: MyOlympiadSchool }) {
  const { data: classes = [], isLoading } = useOlympiadBatchingRoster(school.id);
  const { data: campaigns } = useOlympiadCampaigns();
  const lock = useLockBatchSchedule();
  const navigate = useNavigate();

  const durationMinutes = useMemo(
    () => campaigns?.find((c) => c.id === school.campaign_id)?.exam_duration_minutes,
    [campaigns, school.campaign_id],
  );

  // Lab capacity is owned by the Labs & PCs page (oly_schools.pc_count); the
  // Batch Builder reads it and seats students against it (read-only here).
  const pcCount = school.pc_count ?? 0;
  const [batches, setBatches] = useState<BuilderBatch[]>([]);
  const [lockOpen, setLockOpen] = useState(false);

  const remaining = useMemo(() => remainingByClass(classes, batches), [classes, batches]);
  const totalEnrolled = useMemo(
    () => classes.reduce((n, c) => n + c.studentIds.length, 0),
    [classes],
  );
  const totalUnassigned = Object.values(remaining).reduce((a, b) => a + b, 0);

  const everyoneSeated = classes.length > 0 && allSeated(classes, batches);
  const nonEmpty = batches.filter((b) => b.allocations.length > 0);
  const missingTimes = nonEmpty.some((b) => !b.date || !b.startTime);
  const canLock = everyoneSeated && nonEmpty.length > 0 && !missingTimes;
  const lockHint = !everyoneSeated
    ? `${totalUnassigned} student${totalUnassigned === 1 ? "" : "s"} still unassigned`
    : missingTimes
      ? "Set a date and time on every batch"
      : null;

  const addBatch = () =>
    setBatches((b) => [...b, { id: newId(), date: "", startTime: "", allocations: [] }]);

  const handleLock = async () => {
    const payload: LockBatch[] = nonEmpty.map((b, i) => ({
      scheduled_at: new Date(`${b.date}T${b.startTime}:00+05:30`).toISOString(),
      grade_level_id: batchGradeLevelId(b),
      student_ids: batchStudentIds(b),
      pc_count: pcCount,
      batch_label: batchLabel(b, i),
    }));
    try {
      await lock.mutateAsync({ oly_school_id: school.id, batches: payload });
      setLockOpen(false);
      // page flips to its locked summary on ["olympiad"] invalidation
    } catch {
      /* toastError fires in the hook */
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }
  if (classes.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        title="No enrolled students"
        description="There are no active enrolled students to schedule into batches."
        reason="noData"
      />
    );
  }
  if (pcCount <= 0) {
    return (
      <EmptyState
        icon={<Monitor className="h-7 w-7" />}
        title="Set your lab capacity first"
        description="The batch schedule seats students against your exam-day computer capacity. Add your labs and PCs to continue."
        action={{ label: "Set up Labs & PCs", onClick: () => navigate("/school/olympiad/labs") }}
        reason="noData"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-2 rounded-lg border border-surface-stroke bg-muted/40 px-3 py-2">
            <Monitor className="h-4 w-4 text-ink-500" />
            <span className="text-sm text-ink-600">
              Lab capacity{" "}
              <span className="font-semibold text-ink-900">{pcCount} PC{pcCount === 1 ? "" : "s"}</span>
              <span className="text-ink-400"> / batch</span>
            </span>
            <NavLink
              to="/school/olympiad/labs"
              className="inline-flex items-center gap-1 text-xs font-medium text-brand-primary hover:underline"
            >
              <Pencil className="h-3 w-3" /> Change
            </NavLink>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => setBatches(autoFill(classes, pcCount, newId))}
          >
            <Wand2 className="h-4 w-4 mr-1" /> Auto-fill
          </Button>
        </div>
        <p className="text-sm text-ink-500">
          {totalEnrolled} enrolled across {classes.length} classes
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-3">
          {batches.map((b, i) => (
            <BatchBuilderCard
              key={b.id}
              index={i}
              batch={b}
              batches={batches}
              classes={classes}
              pcCount={pcCount}
              remaining={remaining}
              durationMinutes={durationMinutes}
              onPatch={(patch) =>
                setBatches((all) => all.map((x) => (x.id === b.id ? { ...x, ...patch } : x)))
              }
              onAddClass={(gid) =>
                setBatches((all) => {
                  const cls = classes.find((c) => c.gradeLevelId === gid);
                  return cls ? addClassToBatch(cls, b.id, all, pcCount) : all;
                })
              }
              onRemoveClass={(gid) => setBatches((all) => removeAllocation(b.id, gid, all))}
              onRemoveBatch={() => setBatches((all) => all.filter((x) => x.id !== b.id))}
            />
          ))}
          <Button type="button" variant="outline" className="w-full" onClick={addBatch}>
            <Plus className="h-4 w-4 mr-1" /> Add batch
          </Button>
        </div>

        <RemainingPanel
          classes={classes}
          remaining={remaining}
          totalUnassigned={totalUnassigned}
          canLock={canLock}
          lockHint={lockHint}
          lockPending={lock.isPending}
          onLock={() => setLockOpen(true)}
        />
      </div>

      <LockScheduleDialog
        open={lockOpen}
        onOpenChange={setLockOpen}
        batchCount={nonEmpty.length}
        onConfirm={handleLock}
      />
    </div>
  );
}
