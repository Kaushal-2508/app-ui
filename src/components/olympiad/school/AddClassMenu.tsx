import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { canAddClass, type BatchClass, type BuilderBatch } from "@/lib/olympiad/batchSeating";

type Props = {
  classes: BatchClass[];
  batch: BuilderBatch;
  batches: BuilderBatch[];
  pcCount: number;
  remaining: Record<string, number>;
  onAdd: (gradeLevelId: string) => void;
  disabled?: boolean;
};

/**
 * "+ Add class" dropdown. Lists classes with students still unseated; classes
 * the whole-class-fill rule forbids in THIS batch are disabled with a reason.
 */
export function AddClassMenu({ classes, batch, batches, pcCount, remaining, onAdd, disabled }: Props) {
  const candidates = classes.filter((c) => (remaining[c.gradeLevelId] ?? 0) > 0);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || candidates.length === 0}
        >
          <Plus className="h-4 w-4 mr-1" /> Add class
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1">
        {candidates.length === 0 ? (
          <p className="px-2 py-3 text-sm text-ink-500">All students seated.</p>
        ) : (
          candidates.map((c) => {
            const check = canAddClass(c, batch, batches, pcCount);
            const reason = "reason" in check ? check.reason : undefined;
            return (
              <button
                key={c.gradeLevelId}
                type="button"
                disabled={!check.ok}
                onClick={() => check.ok && onAdd(c.gradeLevelId)}
                className="w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                title={reason}
              >
                <span className="font-medium text-ink-900">{c.classLabel}</span>
                <span className="ml-2 text-ink-500">{remaining[c.gradeLevelId]} left</span>
                {reason && <span className="block text-[11px] text-ink-400">{reason}</span>}
              </button>
            );
          })
        )}
      </PopoverContent>
    </Popover>
  );
}
