// Typed payload shapes for the Phase-1 `dash_*` SECURITY DEFINER RPCs.
// Each RPC returns `Json`; hooks cast `data as unknown as <Interface>` after the
// error guard. These mirror the SQL return shapes exactly (see the Phase-2 plan
// "RPC return shapes" block). Do not widen — narrowness is what keeps the
// widgets/tables honest.

// ── dash_kpi_summary() ────────────────────────────────────────────────────────
export interface KpiSummary {
  attendance_today: {
    present: number;
    total: number;
    marked: boolean;
    pct: number | null;
    week_pct: number | null;
    prev_week_pct: number | null;
  };
  school_avg: {
    pct: number | null;
    prev_pct: number | null;
    exams_count: number;
  };
  students_need_help: {
    count: number;
    prev_count: number | null;
  };
  decisions_waiting: {
    count: number;
  };
}

// ── dash_attendance_trend(p_days) ─────────────────────────────────────────────
export interface AttendanceTrendPoint {
  date: string;
  present: number;
  total: number;
  pct: number | null;
}

export interface AttendanceTrend {
  points: AttendanceTrendPoint[];
  all_time_avg: number | null;
}

// ── dash_subject_performance(p_class_id) ──────────────────────────────────────
export interface SubjectPerformanceRow {
  subject_id: string;
  subject_name: string;
  class_avg: number | null;
  school_avg: number | null;
}

export interface SubjectPerformance {
  has_data: boolean;
  subjects: SubjectPerformanceRow[];
}

// ── dash_student_distribution() ───────────────────────────────────────────────
export interface StudentDistribution {
  doing_well: number;
  catching_up: number;
  needs_help: number;
  total: number;
  evaluated: number;
}

// ── dash_exam_trend(p_limit) -> ExamTrendItem[] ───────────────────────────────
export interface ExamTrendItem {
  exam_id: string;
  title: string;
  exam_type: string;
  avg_pct: number | null;
  participation: number;
  exam_date: string;
}

// ── dash_subject_heatmap() ────────────────────────────────────────────────────
export type HeatmapBand = "red" | "amber" | "green";

export interface SubjectHeatmapCell {
  subject_name: string;
  avg_pct: number;
  band: HeatmapBand;
}

export interface SubjectHeatmapRow {
  band_label: string;
  cells: SubjectHeatmapCell[];
}

export interface SubjectHeatmap {
  grouping: "wings" | "grade";
  rows: SubjectHeatmapRow[];
}

// ── dash_classes_table(p_filters,p_limit,p_offset) ────────────────────────────
export interface ClassesTableRow {
  class_id: string;
  name: string;
  students: number;
  attendance_30d: number | null;
  recent_avg: number | null;
  active_flags: number;
}

export interface ClassesTableResult {
  rows: ClassesTableRow[];
  total: number;
}

// ── dash_students_attention(p_weights,p_filters,p_limit,p_offset) ─────────────
export type StudentBand = "red" | "amber" | "yellow";
export type StudentTrend = "down" | "flat";

export interface StudentsAttentionRow {
  student_id: string;
  name: string;
  roll: string;
  class: string;
  band: StudentBand;
  reason: string;
  attendance: number | null;
  recent_pct: number | null;
  trend: StudentTrend;
  active_flags: number;
}

export interface StudentsAttentionResult {
  rows: StudentsAttentionRow[];
  total: number;
}

// ── dash_teachers_table(p_filters,p_limit,p_offset) ───────────────────────────
export interface TeachersTableRow {
  user_id: string;
  name: string;
  role: string;
  wing: string | null;
  /** Classes they are assigned to teach (all-time workload, not a 30d figure). */
  classes: number;
  /** Everything below is real teaching activity over the last 30 days. */
  lessons_30d: number;
  /** DISTINCT days they marked a register, so six classes in one day counts once. */
  attendance_days_30d: number;
  homework_30d: number;
  exams_30d: number;
  /** Sum of the four. Drives the least-active-first ordering. */
  activity_score: number;
  last_login: string | null;
  active_flags: number;
  /** Title of their most severe open flag, e.g. "Syllabus logging is behind". */
  flag_title: string | null;
  /** That flag's own sentence, e.g. "... has 42 recent school days unlogged". */
  flag_detail: string | null;
  is_new: boolean;
}

export interface TeachersTableResult {
  rows: TeachersTableRow[];
  total: number;
}

// ── dash_recent_exams(p_filters,p_limit,p_offset) ─────────────────────────────
export interface RecentExamsRow {
  exam_id: string;
  title: string;
  status: string;
  exam_type: string;
  exam_date: string | null;
  subjects: string | null;
  classes: string | null;
  attempted: number;
  assigned: number;
  avg_pct: number | null;
  active_flags: number;
}

export interface RecentExamsResult {
  rows: RecentExamsRow[];
  total: number;
}

// ── dash_get_flags() -> Flag[] ────────────────────────────────────────────────
// Phase-3 shape: the evaluator now populates `dashboard_flags`, so the RPC
// returns the full lifecycle row. `severity` drives the dot color
// (critical → destructive, warning → brand-secondary, info → brand-primary);
// `status` drives the chip label (red → "New", amber → "Task created",
// blue → "Task closed, still open"). See spec §8.2.
export type FlagSeverity = "critical" | "warning" | "info";
export type FlagStatus = "red" | "amber" | "blue";

export interface Flag {
  id: string;
  flag_code: string;
  category: string;
  severity: FlagSeverity;
  status: FlagStatus;
  subject_type: string;
  subject_key: string;
  title: string;
  description: string | null;
  metric_value: number | null;
  context: Record<string, unknown> | null;
  link_url: string | null;
  assignee_id: string | null;
  task_id: string | null;
  auto_created: boolean;
  first_detected_at: string;
}
