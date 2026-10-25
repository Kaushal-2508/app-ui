import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { Users, CheckCircle2, TrendingUp, Calendar } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

export function SummaryBanner({ data }: Props) {
  const total = data.live.length;
  const fullyComplete = data.live.filter((r) => r.isJourneyCompleted).length;
  const avgCompletion =
    total === 0
      ? 0
      : data.live.reduce((s, r) => s + Number(r.completionPercent ?? 0), 0) / total;
  const generated = new Date().toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <StatTileGrid mdCols={2} lgCols={4}>
      <StatTile
        label="Total teachers + coordinators"
        value={total.toString()}
        icon={<Users className="h-5 w-5" />}
        tone="teal"
      />
      <StatTile
        label="Fully complete"
        value={fullyComplete.toString()}
        icon={<CheckCircle2 className="h-5 w-5" />}
        tone="mint"
      />
      <StatTile
        label="Avg completion"
        value={`${Math.round(avgCompletion)}%`}
        icon={<TrendingUp className="h-5 w-5" />}
        tone="violet"
      />
      <StatTile
        label="Generated"
        value={generated}
        icon={<Calendar className="h-5 w-5" />}
        tone="peach"
      />
    </StatTileGrid>
  );
}
