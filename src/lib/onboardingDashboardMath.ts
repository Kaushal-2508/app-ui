import type { InstitutionOnboardingRow } from "@/hooks/useOnboardingJourney";

export type MilestoneKey =
  | "first_task_assigned"
  | "first_task_completed"
  | "first_study_material_uploaded"
  | "first_exam_published"
  | "first_result_validated";

export const MILESTONE_KEYS: MilestoneKey[] = [
  "first_task_assigned",
  "first_task_completed",
  "first_study_material_uploaded",
  "first_exam_published",
  "first_result_validated",
];

export const MILESTONE_LABELS: Record<MilestoneKey, string> = {
  first_task_assigned: "First task created or received",
  first_task_completed: "First task completed",
  first_study_material_uploaded: "First study material uploaded",
  first_exam_published: "First exam published",
  first_result_validated: "First result validated or published",
};

export interface SnapshotRow {
  id: string;
  institution_id: string;
  snapshot_date: string;
  total_users: number;
  fully_complete_count: number;
  avg_completion_percent: number;
  milestone_counts: Record<MilestoneKey, number>;
  per_user_data: SnapshotPerUserRow[];
  created_at: string;
  created_by: string | null;
}

export interface SnapshotPerUserRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
  first_task_assigned: boolean;
  first_task_completed: boolean;
  first_study_material_uploaded: boolean;
  first_exam_published: boolean;
  first_result_validated: boolean;
  completed_count: number;
  completion_percent: number;
  is_journey_completed: boolean;
}

export interface Deltas {
  fullyComplete: number;
  avgCompletion: number;
  milestones: Record<MilestoneKey, number>;
  hasBaseline: boolean;
}

const ZERO_DELTAS: Deltas = {
  fullyComplete: 0,
  avgCompletion: 0,
  milestones: {
    first_task_assigned: 0,
    first_task_completed: 0,
    first_study_material_uploaded: 0,
    first_exam_published: 0,
    first_result_validated: 0,
  },
  hasBaseline: false,
};

function liveAggregates(rows: InstitutionOnboardingRow[]) {
  const total = rows.length;
  const fullyComplete = rows.filter((r) => r.isJourneyCompleted).length;
  const avgCompletion =
    total === 0
      ? 0
      : rows.reduce((s, r) => s + Number(r.completionPercent ?? 0), 0) / total;
  const milestones: Record<MilestoneKey, number> = {
    first_task_assigned: rows.filter((r) => r.firstTaskAssigned).length,
    first_task_completed: rows.filter((r) => r.firstTaskCompleted).length,
    first_study_material_uploaded: rows.filter((r) => r.firstStudyMaterialUploaded).length,
    first_exam_published: rows.filter((r) => r.firstExamPublished).length,
    first_result_validated: rows.filter((r) => r.firstResultValidated).length,
  };
  return { total, fullyComplete, avgCompletion, milestones };
}

export function computeDeltas(
  live: InstitutionOnboardingRow[],
  baseline: SnapshotRow | null,
): Deltas {
  if (!baseline) return ZERO_DELTAS;
  const liveAgg = liveAggregates(live);
  const milestoneDeltas = {} as Record<MilestoneKey, number>;
  for (const key of MILESTONE_KEYS) {
    milestoneDeltas[key] = liveAgg.milestones[key] - (baseline.milestone_counts[key] ?? 0);
  }
  return {
    fullyComplete: liveAgg.fullyComplete - baseline.fully_complete_count,
    avgCompletion: Math.round((liveAgg.avgCompletion - Number(baseline.avg_completion_percent)) * 100) / 100,
    milestones: milestoneDeltas,
    hasBaseline: true,
  };
}

const ZERO_LOOKBACK_DAYS = 30;
export const STUCK_TRIGGER_DAYS = 3;
export const STUCK_SEVERE_DAYS = 7;

export function buildZeroDayMap(
  live: InstitutionOnboardingRow[],
  snapshots: SnapshotRow[],
): Map<string, number> {
  const map = new Map<string, number>();
  const todayZeros = new Set(
    live.filter((r) => Number(r.completionPercent) === 0).map((r) => r.userId),
  );
  if (todayZeros.size === 0) return map;

  const sorted = [...snapshots].sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date));

  for (const userId of todayZeros) {
    let streak = 1;
    for (let i = 0; i < Math.min(sorted.length, ZERO_LOOKBACK_DAYS); i++) {
      const snap = sorted[i];
      const userRow = snap.per_user_data.find((u) => u.user_id === userId);
      if (!userRow) break;
      if (Number(userRow.completion_percent) === 0) {
        streak += 1;
      } else {
        break;
      }
    }
    map.set(userId, streak);
  }
  return map;
}

export type AlertSeverity = "info" | "warning" | "critical" | "success";
export type AlertKind = "escalation" | "closeToDone" | "bottleneck" | "momentum";

export interface DashboardAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body: string;
}

const BOTTLENECK_THRESHOLD = 0.3;
const MOMENTUM_THRESHOLD_PP = 5;

export function deriveAlerts(args: {
  live: InstitutionOnboardingRow[];
  deltas: Deltas;
  zeroDayMap: Map<string, number>;
}): DashboardAlert[] {
  const { live, deltas, zeroDayMap } = args;
  const total = live.length;
  const alerts: DashboardAlert[] = [];
  if (total === 0) return alerts;

  const stuck = [...zeroDayMap.entries()]
    .filter(([, days]) => days >= STUCK_TRIGGER_DAYS)
    .sort((a, b) => b[1] - a[1]);
  if (stuck.length > 0) {
    const severeCount = stuck.filter(([, days]) => days >= STUCK_SEVERE_DAYS).length;
    const top = stuck.slice(0, 3).map(([uid, days]) => {
      const u = live.find((r) => r.userId === uid);
      return `${u?.fullName ?? "Unknown"} (${days}d)`;
    }).join(", ");
    alerts.push({
      kind: "escalation",
      severity: severeCount > 0 ? "critical" : "warning",
      title: `${stuck.length} ${stuck.length === 1 ? "person is" : "people are"} stuck at 0 %`,
      body: `Longest: ${top}. ${severeCount > 0 ? `${severeCount} of them ${severeCount === 1 ? "is" : "are"} 7+ days in.` : "Worth a quick nudge."}`,
    });
  }

  const closeCount = live.filter((r) => Number(r.completionPercent) === 80).length;
  if (closeCount > 0) {
    alerts.push({
      kind: "closeToDone",
      severity: "info",
      title: `${closeCount} ${closeCount === 1 ? "person is" : "people are"} one step away from done`,
      body: "One more milestone unlocks 100 % for each of them today.",
    });
  }

  const sm = live.filter((r) => r.firstStudyMaterialUploaded).length;
  const rv = live.filter((r) => r.firstResultValidated).length;
  const bottlenecks: string[] = [];
  if (sm / total < BOTTLENECK_THRESHOLD) bottlenecks.push(`study material upload (${sm}/${total})`);
  if (rv / total < BOTTLENECK_THRESHOLD) bottlenecks.push(`result validation (${rv}/${total})`);
  if (bottlenecks.length > 0) {
    alerts.push({
      kind: "bottleneck",
      severity: "warning",
      title: "Most of your team hasn't crossed a key milestone yet",
      body: `Bottleneck${bottlenecks.length > 1 ? "s" : ""}: ${bottlenecks.join(" and ")}.`,
    });
  }

  if (deltas.hasBaseline && deltas.avgCompletion >= MOMENTUM_THRESHOLD_PP) {
    alerts.push({
      kind: "momentum",
      severity: "success",
      title: `Avg completion jumped ${deltas.avgCompletion.toFixed(1)} points since yesterday`,
      body: "Whatever your team did today, it's working.",
    });
  }

  return alerts;
}

export type Tier = "100" | "80" | "60" | "40" | "20" | "0";
export const TIER_BUCKETS: Tier[] = ["100", "80", "60", "40", "20", "0"];

export function tierOf(percent: number): Tier {
  if (percent >= 100) return "100";
  if (percent >= 80) return "80";
  if (percent >= 60) return "60";
  if (percent >= 40) return "40";
  if (percent >= 20) return "20";
  return "0";
}

export function distributionByTier(live: InstitutionOnboardingRow[]): Record<Tier, number> {
  const buckets: Record<Tier, number> = { "100": 0, "80": 0, "60": 0, "40": 0, "20": 0, "0": 0 };
  for (const r of live) buckets[tierOf(Number(r.completionPercent))] += 1;
  return buckets;
}

export function newlyCompletedToday(
  live: InstitutionOnboardingRow[],
  baseline: SnapshotRow | null,
): Set<string> {
  const todayIds = new Set(live.filter((r) => r.isJourneyCompleted).map((r) => r.userId));
  if (!baseline) return new Set();
  const baselineIds = new Set(
    baseline.per_user_data.filter((u) => u.is_journey_completed).map((u) => u.user_id),
  );
  const result = new Set<string>();
  for (const id of todayIds) if (!baselineIds.has(id)) result.add(id);
  return result;
}
