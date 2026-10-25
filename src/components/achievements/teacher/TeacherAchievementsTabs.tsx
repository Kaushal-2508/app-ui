import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { cn } from "@/lib/utils";

import {
  TEACHER_CATEGORY_META,
  TEACHER_CATEGORY_ORDER,
  type TeacherAchievementCategory,
} from "./teacherCategories";

export interface TeacherAchievementsTabsProps {
  value: TeacherAchievementCategory;
  onValueChange: (value: TeacherAchievementCategory) => void;
  /** Optional per-category earned counts rendered as pill counters. */
  counts?: Partial<Record<TeacherAchievementCategory, number>>;
  /**
   * Render the active category's one-line blurb under the strip. On by default:
   * the blurb is what tells a teacher that "Assessment" rewards papers they
   * WROTE, not exams their students sat.
   */
  showBlurb?: boolean;
  className?: string;
}

/**
 * The five teacher category tabs, on the same shared MobileTabs primitive as
 * the student strip, so it scroll-snaps, auto-centres the active pill and shows
 * edge chevrons when the five labels overflow at 375px.
 */
export function TeacherAchievementsTabs({
  value,
  onValueChange,
  counts,
  showBlurb = true,
  className,
}: TeacherAchievementsTabsProps) {
  const options: MobileTabOption[] = TEACHER_CATEGORY_ORDER.map((category) => {
    const meta = TEACHER_CATEGORY_META[category];
    const Icon = meta.icon;
    return {
      value: category,
      label: meta.label,
      count: counts?.[category],
      icon: <Icon className="h-4 w-4" />,
    };
  });

  return (
    <div className={cn("space-y-2", className)}>
      <MobileTabs
        value={value}
        onValueChange={(next) => onValueChange(next as TeacherAchievementCategory)}
        options={options}
      />
      {showBlurb && (
        <p className="px-1 text-[13px] leading-[18px] text-ink-600">
          {TEACHER_CATEGORY_META[value].blurb}
        </p>
      )}
    </div>
  );
}
