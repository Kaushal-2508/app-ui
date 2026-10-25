import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useHomeworkAnalytics } from "@/hooks/useHomeworkAnalytics";
import { StatTile, StatTileGrid, EmptyState } from "@/components/shared/surfaces";
import { Skeleton } from "@/components/ui/skeleton";
import { ClipboardList, Percent, Send, Clock } from "lucide-react";

export function HomeworkAnalyticsSection({ institutionId }: { institutionId?: string | null }) {
  const eff = useEffectiveInstitution();
  const inst = institutionId !== undefined ? institutionId : eff.institutionId;
  const { data, isLoading } = useHomeworkAnalytics(inst ?? null);

  const pct = (v: number | null | undefined) => (v == null ? "N/A" : `${v}%`);

  return (
    <section className="space-y-3">
      <div>
        <p className="eyebrow">Homework &amp; Assignment</p>
        <h2 className="text-lg font-semibold text-ink-900">Assignment marks</h2>
      </div>
      {isLoading ? (
        <StatTileGrid cols={2} mdCols={4}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-card" />
          ))}
        </StatTileGrid>
      ) : !data || data.total_assignments === 0 ? (
        <EmptyState
          icon={<ClipboardList className="h-7 w-7" />}
          title="No homework marks yet"
          description="Published, graded homework will show here."
          tone="teal"
        />
      ) : (
        <StatTileGrid cols={2} mdCols={4}>
          <StatTile
            label="Avg marks"
            value={pct(data.avg_percentage)}
            icon={<Percent className="h-5 w-5" />}
            tone="teal"
          />
          <StatTile
            label="Submission rate"
            value={pct(data.submission_rate)}
            icon={<Send className="h-5 w-5" />}
            tone="sky"
          />
          <StatTile
            label="On-time rate"
            value={pct(data.on_time_rate)}
            icon={<Clock className="h-5 w-5" />}
            tone="mint"
          />
          <StatTile
            label="Assignments"
            value={data.total_assignments}
            icon={<ClipboardList className="h-5 w-5" />}
            tone="violet"
          />
        </StatTileGrid>
      )}
    </section>
  );
}
