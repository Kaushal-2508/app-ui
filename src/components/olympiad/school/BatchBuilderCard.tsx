import { CalendarDays, Clock, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  batchFree,
  batchSize,
  type BatchClass,
  type BuilderBatch,
} from "@/lib/olympiad/batchSeating";
import { AddClassMenu } from "./AddClassMenu";

type Props = {
  index: number;
  batch: BuilderBatch;
  batches: BuilderBatch[];
  classes: BatchClass[];
  pcCount: number;
  remaining: Record<string, number>;
  durationMinutes?: number;
  onPatch: (patch: Partial<Pick<BuilderBatch, "date" | "startTime">>) => void;
  onAddClass: (gradeLevelId: string) => void;
  onRemoveClass: (gradeLevelId: string) => void;
  onRemoveBatch: () => void;
};

function endLabel(start: string, mins?: number): string | null {
  if (!start || !mins) return null;
  const [h, m] = start.split(":").map(Number);
  const end = new Date(0);
  end.setUTCHours(h, m + mins, 0, 0);
  return `${String(end.getUTCHours()).padStart(2, "0")}:${String(end.getUTCMinutes()).padStart(2, "0")}`;
}

export function BatchBuilderCard({
  index,
  batch,
  batches,
  classes,
  pcCount,
  remaining,
  durationMinutes,
  onPatch,
  onAddClass,
  onRemoveClass,
  onRemoveBatch,
}: Props) {
  const size = batchSize(batch);
  const free = batchFree(batch, pcCount);
  const pct = pcCount > 0 ? Math.min(100, Math.round((size / pcCount) * 100)) : 0;
  const end = endLabel(batch.startTime, durationMinutes);

  return (
    <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-ink-900">Batch {index + 1}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-ink-400 hover:text-red-500"
          onClick={onRemoveBatch}
          aria-label="Remove batch"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span className="eyebrow flex items-center gap-1">
            <CalendarDays className="h-3 w-3" /> Date
          </span>
          <Input type="date" value={batch.date} onChange={(e) => onPatch({ date: e.target.value })} />
        </label>
        <label className="space-y-1">
          <span className="eyebrow flex items-center gap-1">
            <Clock className="h-3 w-3" /> Start time
          </span>
          <Input
            type="time"
            value={batch.startTime}
            onChange={(e) => onPatch({ startTime: e.target.value })}
          />
          {end && <span className="text-[11px] text-ink-500">Ends ~{end}</span>}
        </label>
      </div>

      <div className="space-y-1.5">
        {batch.allocations.length === 0 ? (
          <p className="text-sm text-ink-500">No classes yet. Add one below.</p>
        ) : (
          batch.allocations.map((a) => (
            <div
              key={a.gradeLevelId}
              className="flex items-center justify-between rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
            >
              <span className="text-ink-900">
                {a.classLabel} · {a.studentIds.length}
              </span>
              <button
                type="button"
                onClick={() => onRemoveClass(a.gradeLevelId)}
                className="text-ink-400 hover:text-red-500"
                aria-label={`Remove ${a.classLabel}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="space-y-1.5">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-brand-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[12px] tabular-nums text-ink-500">
            {size} / {pcCount} PCs{free === 0 ? " · full" : ` · ${free} free`}
          </span>
          <AddClassMenu
            classes={classes}
            batch={batch}
            batches={batches}
            pcCount={pcCount}
            remaining={remaining}
            onAdd={onAddClass}
          />
        </div>
      </div>
    </div>
  );
}
