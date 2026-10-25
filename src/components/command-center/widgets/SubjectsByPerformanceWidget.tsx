import * as React from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

import {
  useSubjectPerformance,
  useDashboardClassList,
  type DashboardClassOption,
} from "@/hooks/dashboard/useDashboardData";
import type { SubjectPerformanceRow } from "@/hooks/dashboard/types";
import { useDashboardScope } from "@/hooks/dashboard/DashboardScope";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WidgetCard } from "@/components/command-center/WidgetCard";

const CAPTION =
  "Bars at the top show the subjects this class is weakest in. The thin line on each bar shows the school's average. If a bar is much shorter than the line, this class is behind other classes in that subject.";
const CLICK_HINT = "Tap any subject bar to see how each student is doing in that subject.";

type ClassOption = DashboardClassOption;

// Each chart row carries both averages so the custom tick can be positioned.
interface ChartRow extends SubjectPerformanceRow {
  label: string;
  classValue: number;
}

/**
 * Renders the school-average reference as a thin contrasting vertical tick on
 * top of each horizontal class-average bar. We position it by mapping
 * `school_avg` through the same 0–100 domain the XAxis uses.
 */
function SchoolAvgTick(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: ChartRow;
}) {
  const { x = 0, y = 0, width = 0, height = 0, payload } = props;
  const schoolAvg = payload?.school_avg;
  if (schoolAvg == null || width <= 0) return null;
  // The transparent host bar spans the full 0–100 domain (we feed it value 100),
  // so its pixel width maps linearly: tickX = x + (schoolAvg / 100) * width.
  const tickX = x + (Math.min(Math.max(schoolAvg, 0), 100) / 100) * width;
  const pad = 3;
  return (
    <line
      x1={tickX}
      x2={tickX}
      y1={y + pad}
      y2={y + height - pad}
      stroke="hsl(var(--brand-secondary))"
      strokeWidth={3}
      strokeLinecap="round"
    />
  );
}

interface SubjectsTooltipProps {
  active?: boolean;
  payload?: { payload: ChartRow }[];
}

function SubjectsTooltip({ active, payload }: SubjectsTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-surface-stroke bg-surface-card px-3 py-2 text-xs shadow-card">
      <p className="font-semibold text-ink-900">{row.subject_name}</p>
      <p className="mt-1 text-ink-600">
        This class: <span className="font-medium text-ink-900">{row.classValue}%</span>
      </p>
      <p className="text-ink-600">
        School average:{" "}
        <span className="font-medium text-ink-900">
          {row.school_avg != null ? `${row.school_avg}%` : "N/A"}
        </span>
      </p>
    </div>
  );
}

export function SubjectsByPerformanceWidget() {
  const navigate = useNavigate();
  const scope = useDashboardScope();

  // Scope-aware: institution → all active classes; scoped → the caller's
  // wing / taught classes (resolved server-side by `dash_scoped_class_list`).
  const classesQuery = useDashboardClassList();

  const classes = React.useMemo(() => classesQuery.data ?? [], [classesQuery.data]);
  const [selectedClassId, setSelectedClassId] = React.useState<string | null>(null);

  // Default to the first class once the list lands.
  React.useEffect(() => {
    if (!selectedClassId && classes.length > 0) {
      setSelectedClassId(classes[0].id);
    }
  }, [classes, selectedClassId]);

  const perf = useSubjectPerformance(selectedClassId);

  const chartRows: ChartRow[] = React.useMemo(() => {
    const subjects = perf.data?.subjects ?? [];
    return subjects
      .filter((s) => s.class_avg != null)
      .map((s) => ({
        ...s,
        label: s.subject_name,
        classValue: s.class_avg as number,
      }));
  }, [perf.data]);

  const isLoading = classesQuery.isLoading || (!!selectedClassId && perf.isLoading);
  const isError = classesQuery.isError || perf.isError;
  const hasData = perf.data?.has_data === true && chartRows.length > 0;

  const labelFor = (c: ClassOption) =>
    c.section ? `${c.name} ${c.section}` : c.name;

  const headerSlot =
    classes.length > 0 ? (
      <Select
        value={selectedClassId ?? undefined}
        onValueChange={(v) => setSelectedClassId(v)}
      >
        <SelectTrigger className="h-9 w-[160px] rounded-lg text-sm">
          <SelectValue placeholder="Select class" />
        </SelectTrigger>
        <SelectContent>
          {classes.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {labelFor(c)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    ) : undefined;

  return (
    <WidgetCard
      title="Subjects by performance"
      caption={CAPTION}
      clickHint={CLICK_HINT}
      headerSlot={headerSlot}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => {
        classesQuery.refetch();
        perf.refetch();
      }}
      isEmpty={!isLoading && !isError && !hasData}
      emptyTitle="No exam data yet for this class."
      emptyDescription="Once this class has a published exam, you'll see how it's doing in each subject here."
      emptyAction={{ label: "Create an exam", onClick: () => navigate("/exams/create") }}
    >
      <div style={{ width: "100%", height: 256 }}>
        <ResponsiveContainer>
          <BarChart
            layout="vertical"
            data={chartRows}
            margin={{ top: 4, right: 16, bottom: 4, left: 8 }}
          >
            <CartesianGrid horizontal={false} stroke="hsl(var(--surface-stroke))" />
            <XAxis
              type="number"
              domain={[0, 100]}
              tick={{ fontSize: 11, fill: "hsl(var(--ink-500))" }}
              tickFormatter={(v: number) => `${v}%`}
            />
            <YAxis
              type="category"
              dataKey="label"
              width={90}
              tick={{ fontSize: 11, fill: "hsl(var(--ink-600))" }}
            />
            <Tooltip content={<SubjectsTooltip />} cursor={{ fill: "hsl(var(--ink-400) / 0.06)" }} />
            {/* Class-average bar — the primary readable value. */}
            <Bar
              dataKey="classValue"
              radius={[0, 6, 6, 0]}
              maxBarSize={26}
              /* Teachers are barred from /school/class/:id, so for them every
                 bar was a dead link that bounced to /dashboard. */
              cursor={scope === "teacher" ? "default" : "pointer"}
              onClick={() => {
                if (scope === "teacher") return;
                if (selectedClassId) navigate(`/school/class/${selectedClassId}`);
              }}
            >
              {chartRows.map((row) => (
                <Cell key={row.subject_id} fill="hsl(var(--brand-primary))" />
              ))}
            </Bar>
            {/* Transparent full-domain host bar carrying the school-average tick.
                Rendered ONLY when at least one row actually has a comparison
                value: Recharts groups sibling <Bar>s inside the category band, so
                an always-present host bar takes half the band and pushes the
                visible bar above its own axis label. When every school_avg is
                null (a teacher who teaches the subject in one class only) the
                tick draws nothing anyway, so omitting the host bar leaves the
                class bar alone in the band — centred against its label. */}
            {chartRows.some((r) => r.school_avg != null) && (
              <Bar dataKey={() => 100} fill="transparent" shape={<SchoolAvgTick />} isAnimationActive={false} />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </WidgetCard>
  );
}
