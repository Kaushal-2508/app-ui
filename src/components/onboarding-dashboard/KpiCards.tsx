import { StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { CheckCircle2, Percent, Loader2, Pin, BookOpen, ClipboardCheck } from "lucide-react";
import type { OnboardingDashboardData } from "@/hooks/useOnboardingDashboard";

interface Props {
  data: OnboardingDashboardData;
}

function deltaProp(
  value: number,
  hasBaseline: boolean,
  suffix = "",
): { value: string; direction: "up" | "down" } | undefined {
  if (!hasBaseline) return undefined;
  if (!Number.isFinite(value) || value === 0) return undefined;
  const sign = value > 0 ? "+" : "";
  return {
    value: `${sign}${value}${suffix} vs yesterday`,
    direction: value > 0 ? "up" : "down",
  };
}

export function KpiCards({ data }: Props) {
  const { live, deltas } = data;
  const total = live.length;
  const fullyComplete = live.filter((r) => r.isJourneyCompleted).length;
  const avgCompletion =
    total === 0
      ? 0
      : live.reduce((s, r) => s + Number(r.completionPercent ?? 0), 0) / total;
  const inProgress = live.filter((r) => {
    const p = Number(r.completionPercent);
    return p > 0 && p < 100;
  }).length;
  const stuckOneStep = live.filter((r) => Number(r.completionPercent) === 20).length;
  const studyMaterial = live.filter((r) => r.firstStudyMaterialUploaded).length;
  const resultValidated = live.filter((r) => r.firstResultValidated).length;

  return (
    <StatTileGrid mdCols={2} lgCols={3}>
      <StatTile
        label="Fully complete"
        value={fullyComplete.toString()}
        icon={<CheckCircle2 className="h-5 w-5" />}
        tone="mint"
        delta={deltaProp(deltas.fullyComplete, deltas.hasBaseline)}
      />
      <StatTile
        label="Average completion"
        value={`${Math.round(avgCompletion)}%`}
        icon={<Percent className="h-5 w-5" />}
        tone="violet"
        delta={deltaProp(deltas.avgCompletion, deltas.hasBaseline, "pp")}
      />
      <StatTile
        label="In progress"
        value={inProgress.toString()}
        icon={<Loader2 className="h-5 w-5" />}
        tone="sky"
      />
      <StatTile
        label="Stuck at 1 step only"
        value={stuckOneStep.toString()}
        icon={<Pin className="h-5 w-5" />}
        tone="peach"
      />
      <StatTile
        label="Study material uploaded"
        value={studyMaterial.toString()}
        icon={<BookOpen className="h-5 w-5" />}
        tone="teal"
        delta={deltaProp(deltas.milestones.first_study_material_uploaded, deltas.hasBaseline)}
      />
      <StatTile
        label="Result validated"
        value={resultValidated.toString()}
        icon={<ClipboardCheck className="h-5 w-5" />}
        tone="rose"
        delta={deltaProp(deltas.milestones.first_result_validated, deltas.hasBaseline)}
      />
    </StatTileGrid>
  );
}
