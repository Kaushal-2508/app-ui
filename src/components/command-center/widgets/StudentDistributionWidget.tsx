import * as React from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

import {
  useDashboardClassList,
  useStudentDistribution,
} from "@/hooks/dashboard/useDashboardData";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WidgetCard } from "@/components/command-center/WidgetCard";
import { useDashboardScope } from "@/hooks/dashboard/DashboardScope";

const CAPTION =
  "The red segment shows children who need extra help. Tap any segment to see those students.";
const CLICK_HINT = "Tap a segment to see the list of students in that group.";

export type DistributionBand = "doing_well" | "catching_up" | "needs_help";

interface StudentDistributionWidgetProps {
  /**
   * Lifted to the page so a segment click scrolls/filters the students
   * table.
   *
   * The picked class travels WITH the band. The donut and the list behind it
   * are one interaction: with the donut narrowed to Class 8-A, tapping
   * "Needs help 3" must open those three and not the fifteen the whole school
   * has, or the number and the list contradict each other on the same tap.
   */
  onSelectBand?: (band: DistributionBand, classId: string | null) => void;
}

interface Segment {
  band: DistributionBand;
  name: string;
  value: number;
  color: string;
}

interface SegmentTooltipProps {
  active?: boolean;
  payload?: { payload: Segment }[];
}

function SegmentTooltip({ active, payload }: SegmentTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const seg = payload[0].payload;
  return (
    <div className="rounded-lg border border-surface-stroke bg-surface-card px-3 py-2 text-xs shadow-card">
      <p className="font-semibold text-ink-900">{seg.name}</p>
      <p className="mt-1 text-ink-600">
        <span className="font-medium text-ink-900">{seg.value}</span> students
      </p>
    </div>
  );
}

export function StudentDistributionWidget({ onSelectBand }: StudentDistributionWidgetProps) {
  const scope = useDashboardScope();
  // null = every class in view. The picker only appears when there is more than
  // one class, so a single-class teacher never sees a control with one option.
  const [classId, setClassId] = React.useState<string | null>(null);
  const classesQuery = useDashboardClassList();
  const classes = React.useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  // Coordinators are excluded on purpose: dash_scoped_student_distribution
  // still takes no class, so a picker there would look live and do nothing.
  const showClassPicker =
    (scope === "teacher" || scope === "institution") && classes.length > 1;
  const allLabel = scope === "teacher" ? "All my classes" : "All classes";

  const dist = useStudentDistribution(showClassPicker ? classId : null);
  const data = dist.data;

  const segments: Segment[] = React.useMemo(() => {
    if (!data) return [];
    return [
      {
        band: "doing_well",
        name: "Doing well",
        value: data.doing_well,
        color: "hsl(var(--chart-3))", // green
      },
      {
        band: "catching_up",
        name: "Catching up",
        value: data.catching_up,
        color: "hsl(var(--chart-2))", // amber
      },
      {
        band: "needs_help",
        name: "Needs help",
        value: data.needs_help,
        color: "hsl(var(--destructive))", // red
      },
    ];
  }, [data]);

  const total = data?.total ?? 0;
  // Ten evaluated pupils is a sensible floor for a school- or wing-wide
  // distribution, but it silently blanks the card for a class teacher: a full
  // class of 9 never reaches it. A distribution across 3+ pupils is still
  // readable, so teachers get the lower floor.
  // A narrowed class is one class, so it gets the class-sized floor rather than
  // the school-sized one; otherwise picking a class of 28 could blank the card
  // that was readable a moment earlier.
  const minEvaluated = scope === "teacher" || classId ? 3 : 10;
  const isEmpty = !dist.isLoading && !dist.isError && (data?.evaluated ?? 0) < minEvaluated;
  const narrowedName = classId
    ? (() => {
        const c = classes.find((x) => x.id === classId);
        return c ? [c.name, c.section].filter(Boolean).join(" ") : null;
      })()
    : null;

  const headerSlot = showClassPicker ? (
    <Select
      value={classId ?? "all"}
      onValueChange={(v) => setClassId(v === "all" ? null : v)}
    >
      <SelectTrigger className="h-9 w-[160px] rounded-lg text-sm">
        <SelectValue placeholder={allLabel} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {classes.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.section ? `${c.name} ${c.section}` : c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  ) : undefined;

  return (
    <WidgetCard
      title="Where your students stand"
      caption={CAPTION}
      clickHint={CLICK_HINT}
      headerSlot={headerSlot}
      isLoading={dist.isLoading}
      isError={dist.isError}
      onRetry={() => dist.refetch()}
      isEmpty={isEmpty}
      emptyTitle={
        narrowedName ? `Not enough exam data for ${narrowedName}` : "Not enough exam data yet"
      }
      emptyDescription={
        narrowedName
          ? `Fewer than ${minEvaluated} students in this class have a graded result. Pick another class to compare.`
          : `This will show where your students stand once we have exam data from at least ${minEvaluated} students.`
      }
    >
      <div style={{ width: "100%", height: 256 }} className="relative">
        <ResponsiveContainer>
          <PieChart>
            <Tooltip content={<SegmentTooltip />} />
            <Pie
              data={segments}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={64}
              outerRadius={96}
              paddingAngle={2}
              strokeWidth={0}
              cursor="pointer"
              onClick={(_, index) => {
                const seg = segments[index];
                if (seg) onSelectBand?.(seg.band, showClassPicker ? classId : null);
              }}
            >
              {segments.map((seg) => (
                <Cell key={seg.band} fill={seg.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        {/* Center label — total students. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[32px] font-bold leading-none text-ink-900">{total}</span>
          <span className="eyebrow mt-1">students</span>
        </div>
      </div>
      {/* Legend with counts. */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        {segments.map((seg) => (
          <button
            key={seg.band}
            type="button"
            onClick={() => onSelectBand?.(seg.band, showClassPicker ? classId : null)}
            className="inline-flex items-center gap-2 text-xs text-ink-600 transition-colors duration-200 hover:text-ink-900"
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: seg.color }} />
            <span>
              {seg.name} <span className="font-semibold text-ink-900">{seg.value}</span>
            </span>
          </button>
        ))}
      </div>
    </WidgetCard>
  );
}
