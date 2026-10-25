import { useState } from "react";
import { Banknote, CreditCard, Loader2, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadSchoolDashboard } from "@/hooks/olympiad/useOlympiadSchoolDashboard";
import {
  useOlympiadRevenueByClass,
  type RevenueChannelFilter,
} from "@/hooks/olympiad/useOlympiadRevenueByClass";

const rupees = (amount: number) => `₹${(amount ?? 0).toLocaleString("en-IN")}`;

const CHANNEL_TABS: { value: RevenueChannelFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "cash", label: "Cash" },
];

export default function OlympiadSchoolRevenuePage() {
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: stats, isLoading: statsLoading } = useOlympiadSchoolDashboard(school?.id);
  const [channel, setChannel] = useState<RevenueChannelFilter>("all");
  const byClass = useOlympiadRevenueByClass(school?.id, channel);
  const rows = byClass.data ?? [];
  const channelTotal = rows.reduce((sum, r) => sum + r.revenue_rupees, 0);

  if (schoolLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (!school) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
        This institution is not currently enrolled in the SALCI Olympiad. Please contact SALCI to onboard.
      </div>
    );
  }

  return (
    <div className="space-y-5 py-4">
      {/* Collection KPIs */}
      <section className="space-y-3">
        <header>
          <p className="eyebrow">Collections</p>
        </header>
        {statsLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
        ) : stats && (
          <StatTileGrid cols={1} mdCols={3}>
            <StatTile label="Total revenue" value={rupees(stats.totalRupees)} icon={<Wallet className="h-4 w-4" />} tone="violet" />
            <StatTile
              label={`Online · ${stats.onlineCount} student${stats.onlineCount === 1 ? "" : "s"}`}
              value={rupees(stats.onlineRupees)}
              icon={<CreditCard className="h-4 w-4" />}
              tone="mint"
            />
            <StatTile
              label={`Cash · ${stats.cashCount} student${stats.cashCount === 1 ? "" : "s"}`}
              value={rupees(stats.cashRupees)}
              icon={<Banknote className="h-4 w-4" />}
              tone="sky"
            />
          </StatTileGrid>
        )}
      </section>

      {/* Class-wise distribution */}
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="eyebrow">Distribution</p>
            <h3 className="text-base font-semibold text-ink-900">Class-wise revenue</h3>
          </div>
          <MobileTabs
            variant="segmented"
            value={channel}
            onValueChange={(v) => setChannel(v as RevenueChannelFilter)}
            options={CHANNEL_TABS}
          />
        </header>

        {byClass.isLoading ? (
          <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
        ) : byClass.isError ? (
          // Error BEFORE empty — an RPC failure must never read as "no revenue".
          <div className="space-y-3 py-6 text-center">
            <p className="text-sm text-ink-600">Couldn't load the class-wise breakdown. Please try again.</p>
            <Button variant="outline" size="sm" onClick={() => byClass.refetch()}>Retry</Button>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Wallet className="h-7 w-7" />}
            title="No revenue yet"
            description={
              channel === "all"
                ? "Class-wise collections will appear here as students enroll."
                : `No ${channel} payments recorded yet.`
            }
            reason="noData"
          />
        ) : (
          <ul className="divide-y divide-surface-stroke">
            {rows.map((r) => {
              const share = channelTotal > 0 ? Math.round((r.revenue_rupees / channelTotal) * 100) : 0;
              return (
                <li key={r.grade_level_id} className="space-y-1.5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink-900">{r.grade_name}</p>
                      <p className="text-[11px] text-ink-500">
                        {r.students} student{r.students === 1 ? "" : "s"} paid · {share}% of {channel === "all" ? "total" : `${channel} collections`}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink-900">{rupees(r.revenue_rupees)}</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink-400/10">
                    <div className="h-full rounded-full bg-brand-primary" style={{ width: `${share}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
