import { useState, useRef } from "react";
import { Copy, MoreVertical, RefreshCw, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { useUpdateBatchPinExpiry } from "@/hooks/olympiad/useUpdateBatchPinExpiry";
import { useRegenerateBatchPin } from "@/hooks/olympiad/useRegenerateBatchPin";
import { RegeneratePinDialog } from "./RegeneratePinDialog";
import type { OlympiadBatch } from "@/hooks/olympiad/useOlympiadBatches";

type Props = {
  batch: OlympiadBatch;
};

const STATUS_BADGE: Record<OlympiadBatch["status"], { label: string; variant: "default" | "secondary" | "outline" | "destructive" }> = {
  draft: { label: "Draft", variant: "secondary" },
  locked: { label: "Locked", variant: "default" },
  in_progress: { label: "In progress", variant: "default" },
  completed: { label: "Completed", variant: "outline" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

export function PinCustodyRow({ batch }: Props) {
  const [copied, setCopied] = useState(false);
  const [expiryVal, setExpiryVal] = useState(String(batch.pin_expiry_minutes));
  const [regenOpen, setRegenOpen] = useState(false);
  const updateExpiry = useUpdateBatchPinExpiry();
  const regeneratePin = useRegenerateBatchPin();
  const expiryRef = useRef<HTMLInputElement>(null);

  const copyPin = () => {
    if (!batch.pin) return;
    navigator.clipboard.writeText(batch.pin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast.success("PIN copied");
    });
  };

  const handleExpiryBlur = () => {
    const minutes = parseInt(expiryVal, 10);
    if (isNaN(minutes) || minutes <= 0) {
      setExpiryVal(String(batch.pin_expiry_minutes));
      return;
    }
    if (minutes !== batch.pin_expiry_minutes) {
      updateExpiry.mutate({ batchId: batch.id, minutes });
    }
  };

  const handleRegenConfirm = async () => {
    await regeneratePin.mutateAsync({ batchId: batch.id });
  };

  const pinUsed = batch.pin_first_used_at !== null;
  const statusInfo = STATUS_BADGE[batch.status] ?? { label: batch.status, variant: "secondary" as const };
  const scheduledDate = new Date(batch.scheduled_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

  return (
    <>
      <div className="surface-card frosted-shadow rounded-card p-4 space-y-3">
        {/* Top row: label + status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-ink-900 truncate">{batch.batch_label}</p>
            <p className="text-[11px] text-ink-500 mt-0.5">{scheduledDate}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            {batch.is_absentees && (
              <Badge variant="secondary" className="text-[10px]">Absentees</Badge>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => setRegenOpen(true)}
                  disabled={pinUsed}
                  className={pinUsed ? "opacity-50 cursor-not-allowed" : ""}
                >
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Regenerate PIN
                  {pinUsed && <span className="ml-1 text-[10px] text-ink-500">(already used)</span>}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* PC count + enrolled */}
        <div className="flex items-center gap-4 text-xs text-ink-600">
          <span>
            <span className="font-medium text-ink-900">{batch.enrolled_count ?? 0}</span> / {batch.pc_count} PCs enrolled
          </span>
          {pinUsed && (
            <span className="text-amber-600 font-medium">PIN in use</span>
          )}
        </div>

        {/* PIN + expiry */}
        <div className="flex items-center gap-3">
          {batch.pin ? (
            <button
              type="button"
              onClick={copyPin}
              className="inline-flex items-center gap-2 bg-ink-900/5 dark:bg-ink-900/20 rounded-md px-3 py-1.5 font-mono text-base font-bold tracking-[0.2em] text-ink-900 hover:bg-ink-900/10 transition-colors"
              title="Click to copy PIN"
            >
              {batch.pin}
              {copied ? (
                <CheckCheck className="h-4 w-4 text-brand-primary flex-shrink-0" />
              ) : (
                <Copy className="h-4 w-4 text-ink-500 flex-shrink-0" />
              )}
            </button>
          ) : (
            <span className="text-xs text-ink-500 italic">No PIN assigned</span>
          )}

          <div className="flex items-center gap-1.5 ml-auto">
            <span className="text-[11px] text-ink-500">Expiry</span>
            <Input
              ref={expiryRef}
              type="number"
              min={1}
              value={expiryVal}
              onChange={(e) => setExpiryVal(e.target.value)}
              onBlur={handleExpiryBlur}
              className="w-20 h-7 text-xs text-center"
              aria-label="PIN expiry minutes"
            />
            <span className="text-[11px] text-ink-500">min</span>
          </div>
        </div>
      </div>

      <RegeneratePinDialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        batchLabel={batch.batch_label}
        onConfirm={handleRegenConfirm}
        isPending={regeneratePin.isPending}
      />
    </>
  );
}
