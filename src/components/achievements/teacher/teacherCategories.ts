import {
  ClipboardCheck,
  FileText,
  NotebookPen,
  PenLine,
  Users,
  type LucideIcon,
} from "lucide-react";

/**
 * `badge_definitions.category` values for `badge_type='teacher'`.
 *
 * These five are LOCKED and are NOT the student's five. Every teacher badge in
 * the catalog belongs to exactly one of them, and nothing here is shared with
 * `AchievementCategory` in ../types, which is why the two unions stay separate
 * types rather than one widened union: a teacher tab is not reachable from a
 * student pick and vice versa.
 */
export type TeacherAchievementCategory =
  | "classroom"
  | "assessment"
  | "marking"
  | "homework"
  | "teamwork";

/**
 * Tab order, fixed to the catalog's `display_order` bands:
 * classroom 210-221, assessment 220-232, marking 230-239, homework 240-244,
 * teamwork 250-259. The strip reads as the teaching day does: teach, set the
 * paper, mark it, set the homework, then the work shared with the school.
 * `display_order` only orders tiles WITHIN a tab (tabs filter on `category`),
 * so bands that overlap across categories are harmless.
 */
export const TEACHER_CATEGORY_ORDER: TeacherAchievementCategory[] = [
  "classroom",
  "assessment",
  "marking",
  "homework",
  "teamwork",
];

export interface TeacherCategoryMeta {
  label: string;
  icon: LucideIcon;
  /**
   * One line under the tab strip. Written in a teacher's voice and kept true to
   * the metric behind the category, so "Papers you have written" is the
   * assessment blurb because `exams_created` counts exams a teacher AUTHORED,
   * not exams their students sat.
   */
  blurb: string;
}

export const TEACHER_CATEGORY_META: Record<
  TeacherAchievementCategory,
  TeacherCategoryMeta
> = {
  classroom: {
    label: "Classroom",
    icon: ClipboardCheck,
    blurb: "Attendance marked, lessons planned and delivered, chapters completed",
  },
  assessment: {
    label: "Assessment",
    icon: FileText,
    blurb: "Papers written, published and banked",
  },
  marking: {
    label: "Marking",
    icon: PenLine,
    blurb: "Scripts graded, results published, students given feedback",
  },
  homework: {
    label: "Homework",
    icon: NotebookPen,
    blurb: "Homework set and returned",
  },
  teamwork: {
    label: "Teamwork",
    icon: Users,
    blurb: "Tasks, cover periods and leave reviews for your school",
  },
};

/**
 * Narrow a raw `badge_definitions.category` string.
 *
 * Unknown values fall back to `classroom`, the first tab, so a catalog row added
 * to the DB before this file knows about it still appears somewhere a teacher
 * can find it rather than vanishing from every tab.
 */
export function toTeacherCategory(
  value: string | null | undefined,
): TeacherAchievementCategory {
  return TEACHER_CATEGORY_ORDER.includes(value as TeacherAchievementCategory)
    ? (value as TeacherAchievementCategory)
    : "classroom";
}
