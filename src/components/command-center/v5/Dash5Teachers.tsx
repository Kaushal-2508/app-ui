import { useState } from "react";

import { cn } from "@/lib/utils";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  useDash5Coordinators, useDash5TeacherActivity, type Dash5EngagementLevel,
} from "@/hooks/dashboard/useDash5";

import type { AssignScope } from "./AssignPanel";
import { AssignDrawer } from "./Dash5Drawers";
import { pct1 } from "./format";
import {
  BandPill, LevelTag, TradTable, V5Card, V5CardHead,
  V5Empty, V5Error, V5Loading, tdBase, thBase,
} from "./primitives";
import { useScopeFilter } from "./useScopeFilter";

/**
 * Teachers and staff. Quietest first, so the teachers who need a nudge are at
 * the top rather than buried under the ones who do not.
 *
 * Engagement counts what a teacher DOES in SALCI: papers set, homework set, how
 * recently they signed in. It deliberately excludes student scores, which sit in
 * their own column: mixing outcome into a usage index makes a teacher with
 * strong classes look engaged while never opening the platform.
 */

const ENGAGE: Record<Dash5EngagementLevel, { glyph: string; varName: string }> = {
  Minimal:  { glyph: "■", varName: "--dash-critical" },
  Moderate: { glyph: "◆", varName: "--dash-warning" },
  Strong:   { glyph: "▲", varName: "--dash-exc" },
};

function EngagePill({ level }: { level: Dash5EngagementLevel }) {
  const e = ENGAGE[level];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[11.5px] font-bold"
      style={{
        color: `hsl(var(${e.varName}))`,
        background: `hsl(var(${e.varName}) / 0.12)`,
        borderColor: `hsl(var(${e.varName}) / 0.26)`,
      }}
    >
      <span className="text-[9px] leading-none" aria-hidden>{e.glyph}</span>
      {level}
    </span>
  );
}

const SHOW_TOP = 5;
const ALL_WINGS = "__all__";

export function Dash5TeacherActivity() {
  const { wingLocked } = useScopeFilter();
  const [wing, setWing] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // Who a row's task is being written for. A teacher's work is subject-scoped,
  // but this table is per person, so the ask goes to their wing.
  const [assign, setAssign] = useState<{ scope: AssignScope; title: string; subtitle?: string } | null>(null);
  const q = useDash5TeacherActivity(wing);
  // Only a principal can ask for the cross-wing list, and only a principal
  // has more than one wing to pick from.
  const coords = useDash5Coordinators(!wingLocked);

  const rows = q.data?.rows ?? [];
  const shown = open ? rows : rows.slice(0, SHOW_TOP);
  const wingOptions = coords.data?.rows ?? [];

  return (
    <V5Card className="mb-6">
      <V5CardHead className="items-center">
        <div className="min-w-0 flex-1 basis-[280px]">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Teachers by activity</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">
            Least engaged first. Engagement counts what a teacher does in SALCI, papers set, homework
            set and how recently they signed in, and deliberately leaves out student scores, which sit
            in their own column.
          </p>
        </div>
        {wingOptions.length > 1 && (
          <Select
            value={wing ?? ALL_WINGS}
            onValueChange={(v) => { setWing(v === ALL_WINGS ? null : v); setOpen(false); }}
          >
            <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="All wings" /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_WINGS}>All wings</SelectItem>
              {wingOptions.map((w) => (
                <SelectItem key={w.wing_id} value={w.wing_id}>{w.wing_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {q.data && <LevelTag>{q.data.total} staff · {q.data.minimal} minimal</LevelTag>}
        {rows.length > SHOW_TOP && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="rounded-[10px] border border-surface-stroke px-3 py-1.5 text-[12.5px] font-semibold text-ink-600 hover:bg-surface-stroke/50 hover:text-ink-900"
          >
            {open ? "↑ Show less" : `↓ Show all ${rows.length}`}
          </button>
        )}
      </V5CardHead>

      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load the staff list." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty title={wing ? "Nobody teaches in this wing yet" : "No teaching staff on record yet"} />
        ) : (
          <>
            <TradTable>
              <thead>
                <tr>
                  <th className={thBase}>Teacher</th>
                  <th className={thBase}>Wing</th>
                  {["Classes", "Last active", "Tests created", "Homework given", "Avg score", "Engagement"].map((h) => (
                    <th key={h} className={cn(thBase, "text-right")}>{h}</th>
                  ))}
                  <th className={cn(thBase, "text-right")}>Action</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t, i) => (
                  <tr key={t.id} className={i % 2 === 1 ? "bg-surface-stroke/25" : undefined}>
                    <td className={tdBase}>
                      <div className="font-bold tracking-[-0.01em] text-ink-900">{t.name}</div>
                      <div className="mt-px truncate text-[11.5px] font-medium text-ink-500">
                        {t.subject_names ?? "No subject assigned"}
                      </div>
                    </td>
                    <td className={tdBase}>
                      <span className="whitespace-nowrap text-[11.5px] font-medium text-ink-600">
                        {t.wing_name ?? "Unmapped"}
                      </span>
                    </td>
                    <td className={cn(tdBase, "text-right tabular-nums")}>{t.classes}</td>
                    <td className={cn(tdBase, "text-right tabular-nums")}>
                      {t.last_seen_days == null
                        ? <span className="font-medium text-ink-400">Never</span>
                        : t.last_seen_days === 0 ? "Today" : `${t.last_seen_days}d ago`}
                    </td>
                    <td className={cn(tdBase, "text-right tabular-nums")}>{t.tests}</td>
                    <td className={cn(tdBase, "text-right tabular-nums")}>{t.homework_given}</td>
                    <td className={cn(tdBase, "text-right tabular-nums")}>
                      {t.avg_score == null
                        ? <span className="font-medium text-ink-400">No papers yet</span>
                        : pct1(t.avg_score)}
                    </td>
                    <td className={cn(tdBase, "text-right")}><EngagePill level={t.level} /></td>
                    <td className={cn(tdBase, "text-right")}>
                      <button
                        type="button"
                        onClick={() => setAssign({
                          scope: { wingId: t.wing_id },
                          title: `Assign a task · ${t.name}`,
                          subtitle: [t.wing_name, t.subject_names].filter(Boolean).join(" · ") || undefined,
                        })}
                        className="whitespace-nowrap rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-bold text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/10"
                      >
                        Assign task
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TradTable>
            {rows.length > SHOW_TOP && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="mt-3 w-full border-t border-surface-stroke pt-3 text-center text-[12.5px] font-bold text-brand-primary hover:underline"
              >
                {open ? "Show less" : `Show all ${rows.length} teachers`}
              </button>
            )}
          </>
        )}
      </div>

      <AssignDrawer
        open={!!assign}
        onOpenChange={(v) => !v && setAssign(null)}
        scope={assign?.scope ?? null}
        title={assign?.title ?? "Assign a task"}
        subtitle={assign?.subtitle}
      />
    </V5Card>
  );
}

/* ------------------------------------------------------- coordinators ----- */

export function Dash5Coordinators() {
  const q = useDash5Coordinators();
  const rows = q.data?.rows ?? [];
  const [assign, setAssign] = useState<{ scope: AssignScope; title: string; subtitle?: string } | null>(null);

  return (
    <V5Card className="mb-8">
      <V5CardHead>
        <div className="flex-1">
          <h3 className="m-0 text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Coordinator by wing</h3>
          <p className="m-0 mt-0.5 text-xs font-medium text-ink-500">Each coordinator against the wing they run.</p>
        </div>
      </V5CardHead>
      <div className="px-4 pb-4 sm:px-[18px]">
        {q.isLoading ? (
          <V5Loading />
        ) : q.isError ? (
          <V5Error label="Couldn't load coordinators." onRetry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <V5Empty title="No wings set up yet" sub="Map classes into wings to see this breakdown." />
        ) : (
          <TradTable>
            <thead>
              <tr>
                <th className={thBase}>Coordinator</th>
                {["Classes", "Teachers", "Average score", "Coverage", "Attendance", "Tasks closed", "Overdue"].map((h) => (
                  <th key={h} className={cn(thBase, "text-right")}>{h}</th>
                ))}
                <th className={thBase}>Wing</th>
                <th className={cn(thBase, "text-right")}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.wing_id} className={i % 2 === 1 ? "bg-surface-stroke/25" : undefined}>
                  <td className={tdBase}>
                    <div className="font-bold tracking-[-0.01em] text-ink-900">
                      {r.coordinator ?? <span className="font-medium text-ink-400">No coordinator assigned</span>}
                    </div>
                    <div className="mt-px text-[11.5px] font-medium text-ink-500">
                      {r.wing_name} · {r.students.toLocaleString()} students
                    </div>
                  </td>
                  <td className={cn(tdBase, "text-right tabular-nums")}>{r.classes}</td>
                  <td className={cn(tdBase, "text-right")}>
                    <span className="block tabular-nums">{r.teachers}</span>
                    <span className="mt-px block whitespace-nowrap text-[10.5px] font-medium text-ink-400">
                      {r.teachers_minimal > 0 ? `${r.teachers_minimal} minimal use` : "all engaged"}
                    </span>
                  </td>
                  <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(r.avg_score)}</td>
                  <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(r.coverage_pct)}</td>
                  <td className={cn(tdBase, "text-right tabular-nums")}>{pct1(r.attendance_pct)}</td>
                  <td className={cn(tdBase, "text-right tabular-nums")}>
                    {r.tasks_total === 0
                      ? <span className="font-medium text-ink-400">None yet</span>
                      : `${r.tasks_closed} / ${r.tasks_total}`}
                  </td>
                  <td className={cn(tdBase, "text-right tabular-nums font-bold")}
                      style={r.tasks_overdue > 6 ? { color: "hsl(var(--dash-critical))" } : undefined}>
                    {r.tasks_overdue}
                  </td>
                  <td className={tdBase}><BandPill band={r.band} /></td>
                  <td className={cn(tdBase, "text-right")}>
                    <button
                      type="button"
                      onClick={() => setAssign({
                        scope: { wingId: r.wing_id },
                        title: `Assign a task · ${r.wing_name}`,
                        subtitle: r.coordinator ?? "No coordinator assigned",
                      })}
                      className="whitespace-nowrap rounded-[9px] border border-surface-stroke px-2.5 py-1 text-[12px] font-bold text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/10"
                    >
                      Assign task
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TradTable>
        )}
      </div>
      <AssignDrawer
        open={!!assign}
        onOpenChange={(v) => !v && setAssign(null)}
        scope={assign?.scope ?? null}
        title={assign?.title ?? "Assign a task"}
        subtitle={assign?.subtitle}
      />
    </V5Card>
  );
}
