import { Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadSchoolPaymentList } from "@/hooks/olympiad/useOlympiadSchoolPaymentList";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  channel: "cash" | "online";
};

const rupees = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;

export function SchoolPaymentDrilldownSheet({ open, onOpenChange, olySchoolId, channel }: Props) {
  const q = useOlympiadSchoolPaymentList(olySchoolId, channel, open);
  const rows = (q.data?.pages ?? []).flat();

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={channel === "cash" ? "Cash payments" : "Online payments"}
      subtitle={`${rows.length} student${rows.length === 1 ? "" : "s"}`}
    >
      {q.isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Wallet className="h-7 w-7" />}
          title="No payments"
          description={`No ${channel} payments recorded yet.`}
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <div key={r.oly_student_id} className="surface-card frosted-shadow rounded-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ink-900 truncate">{r.full_name}</p>
                  <p className="text-xs text-ink-500">{r.roll_number}</p>
                </div>
                <p className="text-sm font-semibold text-ink-900">{rupees(r.total_rupees)}</p>
              </div>
              {channel === "online" && (r.gateway_payment_id || r.gateway_order_id) && (
                <div className="mt-2 space-y-0.5 text-[11px] text-ink-500">
                  {r.gateway_payment_id && <p>Payment: <code>{r.gateway_payment_id}</code></p>}
                  {r.gateway_order_id && <p>Order: <code>{r.gateway_order_id}</code></p>}
                </div>
              )}
            </div>
          ))}
          {q.hasNextPage && (
            <Button
              variant="outline"
              className="w-full"
              disabled={q.isFetchingNextPage}
              onClick={() => q.fetchNextPage()}
            >
              {q.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Load more
            </Button>
          )}
        </div>
      )}
    </MobileSheet>
  );
}
