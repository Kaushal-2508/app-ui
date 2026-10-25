import type { FlagSeverity, FlagStatus } from "@/hooks/dashboard/types";

/**
 * Severity → dot color token (spec §8.2). Critical = destructive red,
 * Warning = brand-secondary amber, Info = brand-primary blue. Tokens only —
 * no raw hex. Unknown values fall back to a neutral dot.
 */
export function severityDot(severity: FlagSeverity | string): string {
  switch (severity) {
    case "critical":
      return "bg-destructive";
    case "warning":
      return "bg-brand-secondary";
    case "info":
      return "bg-brand-primary";
    default:
      return "bg-ink-400";
  }
}

export interface StatusChip {
  label: string;
  /** Tailwind classes for the chip — tinted to match the status. */
  className: string;
}

/**
 * Status → chip label + tint (brief / spec §8.2):
 * - red   → "New"                       (nobody has acted)
 * - amber → "Task created"              (a task exists)
 * - blue  → "Task closed, still open"   (task done but condition persists)
 */
export function statusChip(status: FlagStatus | string): StatusChip {
  switch (status) {
    case "red":
      return { label: "New", className: "bg-destructive/10 text-destructive" };
    case "amber":
      return { label: "Task created", className: "bg-brand-secondary/15 text-brand-secondary" };
    case "blue":
      return { label: "Task closed, still open", className: "bg-brand-primary/10 text-brand-primary" };
    default:
      return { label: status, className: "bg-ink-400/10 text-ink-600" };
  }
}

/** Stable severity ordering for in-group sort: critical → warning → info. */
export const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/** Human-friendly category section labels. */
export const CATEGORY_LABELS: Record<string, string> = {
  attendance: "Attendance",
  exams: "Exams",
  adoption: "Adoption",
  syllabus: "Syllabus",
};

export function categoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/** Canonical display order of category sections. */
export const CATEGORY_ORDER = ["attendance", "exams", "adoption", "syllabus"] as const;
