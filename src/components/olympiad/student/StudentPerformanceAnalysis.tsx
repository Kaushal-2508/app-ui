import { useMemo } from "react";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import { CheckCircle2, AlertTriangle, Loader2, Timer, Rabbit, Turtle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  useOlympiadStudentAnalysis,
  type TopicStat,
} from "@/hooks/olympiad/useOlympiadStudentAnalysis";

const pctTone = (p: number) =>
  p >= 80
    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
    : p >= 60
      ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300"
      : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300";

const fmtSecs = (s: number | null | undefined) => {
  if (s == null) return "N/A";
  if (s < 60) return `${Math.round(s)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

function Card({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5 space-y-3">
      <header>
        <p className="eyebrow">{eyebrow}</p>
        <h3 className="text-base font-semibold text-ink-900">{title}</h3>
        {subtitle && <p className="text-xs text-ink-600 mt-0.5">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

function TopicLine({ t }: { t: TopicStat }) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink-900">{t.topic_name}</p>
        <p className="text-[11px] text-ink-500">
          {t.subject_name} · {t.correct}/{t.questions} correct
        </p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", pctTone(t.pct_correct))}>
        {t.pct_correct}%
      </span>
    </li>
  );
}

/**
 * Post-result intelligence section of the student Olympiad dashboard — built
 * only from real attempt data: per-topic (competency) accuracy radar,
 * strengths / focus areas, you-vs-class-vs-school benchmark, and time
 * intelligence from per-question time_spent_seconds.
 */
export function StudentPerformanceAnalysis({ studentId }: { studentId?: string }) {
  const { data, isLoading, isError, refetch } = useOlympiadStudentAnalysis(true, studentId);

  const derived = useMemo(() => {
    if (!data || !data.ok) return null;
    const topics = data.topics;
    const byAccuracyDesc = [...topics].sort((a, b) => b.pct_correct - a.pct_correct);
    const strengths = byAccuracyDesc.slice(0, 3);
    const focusAreas = byAccuracyDesc
      .slice(strengths.length)
      .sort((a, b) => a.pct_correct - b.pct_correct)
      .slice(0, 3);
    const radarTopics = [...topics]
      .sort((a, b) => b.questions - a.questions)
      .slice(0, 6)
      .map((t) => ({
        topic: t.topic_name.length > 16 ? `${t.topic_name.slice(0, 15)}…` : t.topic_name,
        value: t.pct_correct,
      }));
    const answered = topics.filter((t) => t.attempted > 0);
    const slowest = [...answered].sort((a, b) => b.avg_time_seconds - a.avg_time_seconds)[0] ?? null;
    const fastest = [...answered].sort((a, b) => a.avg_time_seconds - b.avg_time_seconds)[0] ?? null;
    return { strengths, focusAreas, radarTopics, slowest, fastest };
  }, [data]);

  if (isLoading) {
    return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (isError) {
    // Error BEFORE silence — a failed RPC must not look like "no analysis".
    return (
      <div className="surface-card frosted-shadow rounded-card space-y-3 p-6 text-center">
        <p className="text-sm text-ink-600">Couldn't load your performance analysis.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }
  if (!data || !data.ok || !derived) return null;

  const { time, benchmark } = data;
  const bars = [
    { label: "You", value: Number(benchmark.student_pct), cls: "bg-brand-primary" },
    { label: "Class average", value: benchmark.class_avg_pct != null ? Number(benchmark.class_avg_pct) : null, cls: "bg-brand-secondary" },
    { label: "School average", value: benchmark.school_avg_pct != null ? Number(benchmark.school_avg_pct) : null, cls: "bg-ink-400/50" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card eyebrow="Skill intelligence" title="Topic radar" subtitle="Your accuracy by topic">
          {derived.radarTopics.length >= 3 ? (
            <>
              <div style={{ width: "100%", height: 260 }}>
                <ResponsiveContainer>
                  <RadarChart data={derived.radarTopics} outerRadius="70%">
                    <PolarGrid stroke="hsl(var(--surface-stroke))" />
                    <PolarAngleAxis
                      dataKey="topic"
                      tick={{ fill: "hsl(var(--ink-500))", fontSize: 10 }}
                    />
                    <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar
                      dataKey="value"
                      stroke="hsl(var(--brand-primary))"
                      fill="hsl(var(--brand-primary))"
                      fillOpacity={0.25}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-ink-600">
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />80–100 Strong</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />60–79 Developing</span>
                <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-500" />0–59 Needs attention</span>
              </div>
            </>
          ) : (
            <ul className="divide-y divide-surface-stroke">
              {data.topics.map((t) => <TopicLine key={`${t.subject_name}-${t.topic_name}`} t={t} />)}
            </ul>
          )}
        </Card>

        <div className="grid grid-cols-1 gap-4">
          <Card eyebrow="Where you shine" title="Strengths">
            <ul className="divide-y divide-surface-stroke">
              {derived.strengths.map((t) => (
                <li key={`${t.subject_name}-${t.topic_name}`} className="flex items-center gap-2.5 py-1.5">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-900">{t.topic_name}</p>
                    <p className="text-[11px] text-ink-500">{t.subject_name}</p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", pctTone(t.pct_correct))}>
                    {t.pct_correct}%
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          {derived.focusAreas.length > 0 && (
            <Card eyebrow="Where to improve" title="Focus areas">
              <ul className="divide-y divide-surface-stroke">
                {derived.focusAreas.map((t) => (
                  <li key={`${t.subject_name}-${t.topic_name}`} className="flex items-center gap-2.5 py-1.5">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-brand-secondary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">{t.topic_name}</p>
                      <p className="text-[11px] text-ink-500">{t.subject_name}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", pctTone(t.pct_correct))}>
                      {t.pct_correct}%
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card eyebrow="Benchmark" title="How you compare" subtitle="Overall score vs your class and school">
          <ul className="space-y-3">
            {bars.map((b) => (
              <li key={b.label} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className={b.label === "You" ? "font-semibold text-ink-900" : "text-ink-600"}>{b.label}</span>
                  <span className="font-semibold tabular-nums text-ink-900">
                    {b.value != null ? `${Math.round(b.value * 10) / 10}%` : "N/A"}
                  </span>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-ink-400/10">
                  <div
                    className={cn("h-full rounded-full", b.cls)}
                    style={{ width: `${Math.min(100, Math.max(0, b.value ?? 0))}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <Card eyebrow="Time intelligence" title="How you spent your time" subtitle={`Total exam time: ${fmtSecs(time.total_seconds)}`}>
          <ul className="space-y-2.5">
            <li className="flex items-center gap-2.5 text-sm">
              <Timer className="h-4 w-4 shrink-0 text-brand-primary" />
              <span className="flex-1 text-ink-600">Average per question</span>
              <span className="font-semibold tabular-nums text-ink-900">{fmtSecs(time.avg_seconds_per_question)}</span>
            </li>
            {derived.fastest && (
              <li className="flex items-center gap-2.5 text-sm">
                <Rabbit className="h-4 w-4 shrink-0 text-emerald-500" />
                <span className="flex-1 truncate text-ink-600">Fastest topic · {derived.fastest.topic_name}</span>
                <span className="font-semibold tabular-nums text-ink-900">{fmtSecs(derived.fastest.avg_time_seconds)}</span>
              </li>
            )}
            {derived.slowest && (
              <li className="flex items-center gap-2.5 text-sm">
                <Turtle className="h-4 w-4 shrink-0 text-brand-secondary" />
                <span className="flex-1 truncate text-ink-600">Slowest topic · {derived.slowest.topic_name}</span>
                <span className="font-semibold tabular-nums text-ink-900">{fmtSecs(derived.slowest.avg_time_seconds)}</span>
              </li>
            )}
            <li className="flex items-center gap-2.5 text-sm">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              <span className="flex-1 text-ink-600">Avg time when correct</span>
              <span className="font-semibold tabular-nums text-ink-900">{fmtSecs(time.avg_seconds_correct)}</span>
            </li>
            <li className="flex items-center gap-2.5 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-500" />
              <span className="flex-1 text-ink-600">Avg time when incorrect</span>
              <span className="font-semibold tabular-nums text-ink-900">{fmtSecs(time.avg_seconds_incorrect)}</span>
            </li>
            <li className="flex items-center gap-2.5 text-sm">
              <HelpCircle className="h-4 w-4 shrink-0 text-ink-500" />
              <span className="flex-1 text-ink-600">Unanswered questions</span>
              <span className="font-semibold tabular-nums text-ink-900">{time.unanswered}</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
