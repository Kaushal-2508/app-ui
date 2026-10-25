import { PinCustodyRow } from "./PinCustodyRow";
import type { OlympiadBatch } from "@/hooks/olympiad/useOlympiadBatches";

type Props = {
  batches: OlympiadBatch[];
};

export function PinCustodyTable({ batches }: Props) {
  const visible = batches
    .filter((b) => b.status !== "cancelled" && b.status !== "draft")
    .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime());

  if (visible.length === 0) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
        No locked batches yet.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map((batch) => (
        <PinCustodyRow key={batch.id} batch={batch} />
      ))}
    </div>
  );
}
