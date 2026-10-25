import { format } from "date-fns";
import type { Tone } from "@/components/shared/design-system";
import type { DuaEntry, DuaRole } from "@/hooks/deletedUsers/useDeletedUsers";

export const ROLE_LABELS: Record<string, string> = {
  student: "Student",
  teacher: "Teacher",
  coordinator: "Coordinator",
  school_admin: "School admin",
  super_school_admin: "Super school admin",
  super_admin: "Super admin",
  employee: "Employee",
};

export const roleLabel = (role: string | null | undefined) =>
  role ? ROLE_LABELS[role] ?? humanize(role) : "Unknown role";

export const ENTRY_META: Record<DuaEntry, { label: string; tone: Tone }> = {
  complete: { label: "Complete", tone: "mint" },
  partial: { label: "Partial history", tone: "peach" },
  on_request: { label: "At their request", tone: "violet" },
  capture_failed: { label: "Capture failed", tone: "rose" },
};

export const SOURCE_LABELS: Record<string, string> = {
  app: "In the app",
  auth_api: "Auth API, no app actor",
  sql: "Direct SQL",
  legacy: "Before the archive",
  other: "Other",
};

export const sourceLabel = (source: string | null | undefined) => {
  const key = (source ?? "").split(":")[0];
  return SOURCE_LABELS[key] ?? humanize(key || "unknown");
};

export function humanize(key: string): string {
  const s = key.replace(/^public\./, "").replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const d = (iso: string) => format(new Date(iso), "d MMM yyyy");

/** "Deleted 5 Oct 2026", or a range for entries from before the archive. */
export function deletedWhen(row: { deleted_at: string | null; deleted_at_min: string | null; deleted_at_max: string | null }): string {
  if (row.deleted_at) return `Deleted ${d(row.deleted_at)}`;
  if (row.deleted_at_min && row.deleted_at_max) return `Deleted between ${d(row.deleted_at_min)} and ${d(row.deleted_at_max)}`;
  if (row.deleted_at_max) return `Deleted before ${d(row.deleted_at_max)}`;
  if (row.deleted_at_min) return `Deleted after ${d(row.deleted_at_min)}`;
  return "Deletion date unknown";
}

/** Distinct role labels, one chip each. */
export function roleChips(roles: DuaRole[] | null | undefined): string[] {
  return [...new Set((roles ?? []).map((r) => roleLabel(r.role)))];
}

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** One archived value as text for a row card. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "N/A";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    if (ISO_RE.test(value)) {
      const dt = new Date(value);
      if (!Number.isNaN(dt.getTime())) return format(dt, "d MMM yyyy, HH:mm");
    }
    if (DATE_RE.test(value)) return format(new Date(`${value}T00:00:00`), "d MMM yyyy");
    return value;
  }
  const json = JSON.stringify(value);
  return json.length > 300 ? `${json.slice(0, 300)}…` : json;
}

export function formatBytes(n: number | null | undefined): string {
  if (!n || n <= 0) return "N/A";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Column order for a row card: registry columns first, then everything else when "all fields" is on. */
export function columnsFor(row: Record<string, unknown>, displayColumns: string[], allFields: boolean): string[] {
  const keys = Object.keys(row);
  const preferred = displayColumns.filter((c) => keys.includes(c));
  if (!allFields && preferred.length > 0) return preferred;
  const rest = keys.filter((k) => !preferred.includes(k)).sort();
  return [...preferred, ...rest];
}

export const CATEGORY_ORDER = [
  "Academics", "Attendance", "Homework", "Fees", "Staff and HR", "Communication", "PTM",
  "Tasks and targets", "Timetable and lesson plans", "Syllabus and content", "Roles and assignments",
  "Admin and settings", "Account and devices", "Other",
];
