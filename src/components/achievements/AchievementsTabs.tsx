import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { cn } from "@/lib/utils";

import { ACHIEVEMENT_CATEGORY_META, ACHIEVEMENT_CATEGORY_ORDER } from "./categories";
import type { AchievementCategory } from "./types";

export interface AchievementsTabsProps {
  value: AchievementCategory;
  onValueChange: (value: AchievementCategory) => void;
  /** Optional per-category badge counts rendered as pill counters. */
  counts?: Partial<Record<AchievementCategory, number>>;
  /**
   * Render the active category's one-line blurb under the strip. On by default:
   * the blurb is what tells a student what a category like "Clutch Plays"
   * actually rewards before they scan 4 tiles to work it out.
   */
  showBlurb?: boolean;
  className?: string;
}

/**
 * The five category tabs. Built on the shared MobileTabs primitive, so the
 * strip scroll-snaps, auto-centres the active pill and shows edge chevrons
 * when the five labels overflow at 375px.
 */
export function AchievementsTabs({
  value,
  onValueChange,
  counts,
  showBlurb = true,
  className,
}: AchievementsTabsProps) {
  const options: MobileTabOption[] = ACHIEVEMENT_CATEGORY_ORDER.map((category) => {
    const meta = ACHIEVEMENT_CATEGORY_META[category];
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
        onValueChange={(next) => onValueChange(next as AchievementCategory)}
        options={options}
      />
      {showBlurb && (
        <p className="px-1 text-[13px] leading-[18px] text-ink-600">
          {ACHIEVEMENT_CATEGORY_META[value].blurb}
        </p>
      )}
    </div>
  );
}
