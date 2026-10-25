// Typed payload shapes for the coordinator-only `dash_scoped_*` RPCs added for
// the wing dashboard (migrations 20260825120000..20260825124000).
//
// Same contract as `types.ts`: each RPC returns `Json`, the hook casts
// `data as unknown as <Interface>` after the error guard, and these interfaces
// mirror the SQL return shape exactly. Do not widen.

// ── dash_scoped_wing_standing() ───────────────────────────────────────────────
export interface WingStandingComponent {
  key: "academic" | "student_adoption" | "teacher_adoption" | "attendance";
  label: string;
  pct: number | null;
  points: number | null;
  max_points: number;
}

export interface WingStanding {
  has_wing: boolean;
  wing_name?: string;
  rank?: number;
  total_wings?: number;
  score?: number;
  avg_pct?: number | null;
  school_avg_pct?: number | null;
  components?: WingStandingComponent[];
}

// ── dash_scoped_student_portal_adoption(p_limit) ──────────────────────────────
export interface AdoptionClassRow {
  class_id: string;
  class_name: string;
  students: number;
  active_30d: number;
  never: number;
  pct: number | null;
}

export interface NeverSignedInStudent {
  student_id: string;
  name: string;
  class: string | null;
}

export interface StudentPortalAdoption {
  total: number;
  never_signed_in: number;
  active_1d: number;
  active_7d: number;
  active_30d: number;
  pct_active_7d: number | null;
  pct_active_30d: number | null;
  never_list: NeverSignedInStudent[];
  by_class: AdoptionClassRow[];
}

// ── dash_scoped_teacher_adoption(p_limit) ─────────────────────────────────────
// `available: false` is a first-class state, not an error: it means the signal
// has no data behind it (nobody logs syllabus progress, every attendance row
// uses the same method). The card renders `unavailable_reason` instead of a
// misleading 0%.
export interface TeacherAdoptionSignal {
  key: "login_recency" | "exams_in_system" | "attendance_digital" | "syllabus_pacing";
  label: string;
  available: boolean;
  value: number | null;
  of: number | null;
  pct: number | null;
  unavailable_reason?: string | null;
}

export interface TeacherLaggard {
  teacher_id: string;
  name: string;
  last_sign_in_at: string | null;
  days_inactive: number | null;
  classes: string | null;
  exams_created: number;
}

export interface TeacherAdoption {
  total: number;
  never_signed_in: number;
  active_1d: number;
  active_7d: number;
  active_30d: number;
  signals: TeacherAdoptionSignal[];
  laggards: TeacherLaggard[];
}

// ── dash_scoped_class_performance() ───────────────────────────────────────────
export interface ClassPerformanceRow {
  class_id: string;
  class_name: string;
  avg_pct: number | null;
  results: number;
  students: number;
}

export interface ClassPerformance {
  rows: ClassPerformanceRow[];
  scope_avg_pct: number | null;
}

// ── dash_scoped_attendance_compliance(p_days) ─────────────────────────────────
export interface AttendanceComplianceRow {
  class_id: string;
  class_name: string;
  days_marked: number;
  days_expected: number;
  pct: number | null;
  last_marked: string | null;
  missing_latest: boolean;
}

export interface AttendanceCompliance {
  rows: AttendanceComplianceRow[];
  total_classes: number;
  missing_today: number;
  latest_date: string | null;
  working_days: number;
}

// ── dash_scoped_recheck_stats() / dash_scoped_recheck_queue() ─────────────────
export interface RecheckStats {
  pending: number;
  completed_30d: number;
  rejected_30d: number;
  avg_resolution_days: number | null;
  oldest_pending_days: number | null;
}

export interface RecheckQueueRow {
  id: string;
  student_name: string | null;
  class_name: string;
  exam_title: string;
  question_order: number | null;
  question_text: string | null;
  reason: string | null;
  status: string;
  previous_marks: number | null;
  new_marks: number | null;
  requested_at: string;
  days_pending: number;
}

export interface RecheckQueue {
  rows: RecheckQueueRow[];
  total: number;
}

// ── dash_scoped_task_stats() / dash_scoped_task_queue() ───────────────────────
export interface TaskStats {
  open: number;
  overdue: number;
  completed: number;
  total: number;
  completion_rate: number | null;
  avg_closure_days: number | null;
}

export interface TaskQueueRow {
  id: string;
  title: string;
  status: string;
  priority: number | null;
  due_date: string | null;
  assignee_name: string | null;
  assignee_id: string | null;
  days_overdue: number | null;
  auto_created: boolean;
}

export interface TaskQueue {
  rows: TaskQueueRow[];
  total: number;
}

// ── dash_scoped_digest() ──────────────────────────────────────────────────────
export interface DigestItem {
  code: string;
  severity: "critical" | "warning" | "info";
  headline: string;
  detail: string | null;
  link_url: string | null;
}

// ── dash_scoped_resolve_recheck() ─────────────────────────────────────────────
export interface ResolveRecheckResult {
  result: "approved" | "rejected" | "already_resolved";
  marks_changed?: boolean;
}
