import { motion } from "framer-motion";
import { type LucideIcon } from "lucide-react";
import { StaggerContainer, StaggerItem } from "@/components/ui/animated-container";
import { FeatureTile } from "@/components/shared/surfaces";
import type { Tone } from "@/components/shared/design-system";
import { useProfileData } from "@/hooks/useProfileData";
import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { FEATURE_URL_MAP } from "@/components/admin/institution-wizard/featuresData";
import { useRotatingGreeting } from "@/hooks/useRotatingGreeting";

import { PageShell } from "@/components/shared/page";
import { SchoolSceneIllustration } from "@/components/shared/illustrations";
import { StaffCheckInCard } from "@/components/attendance/StaffCheckInCard";
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { DashboardTopSlot } from "./actions/DashboardTopSlot";
import { MedalChip } from "./MedalChip";

export interface NavItem {
  title: string;
  url: string;
  icon: LucideIcon;
  description: string;
}

export interface NavGroup {
  group: string;
  gradient: "purple" | "blue" | "emerald" | "amber";
  items: NavItem[];
}

interface NavigationHubProps {
  roleName: string;
  navGroups: NavGroup[];
  /**
   * Today's work, rendered between the greeting and the tile grid (the
   * teacher's "My day", 2026-10-14). The tiles stay below it as "all tools".
   */
  today?: React.ReactNode;
  /**
   * Render today's self check-in card directly under the greeting, so staff
   * can mark their own attendance from the first screen on a phone instead
   * of finding the Attendance page first (asked 2026-09-26). It is the same
   * StaffCheckInCard the Attendance page shows, with every state it already
   * handles (holiday, auto-absent, checked in, checked out), and it obeys
   * the same feature gate as the Attendance tile: hidden when the
   * institution has the attendance feature off.
   */
  showCheckIn?: boolean;
  /**
   * The view whose action cards replace the banner when something is due (spec 2026-10-03).
   * Only the teacher dashboard passes it; the school admin's category sub-grid keeps the
   * banner.
   */
  actionsView?: ViewRole;
  /**
   * Render the small medal chip beside the subtitle under the greeting
   * (2026-10-12, "it must be seen in home page", then "just a small near
   * name"). Only the teacher dashboard passes it: the chip reads the teacher
   * badge ladder, which admins do not have. It is not feature gated because
   * /achievements is not either (no FEATURE_URL_MAP entry), so the chip and
   * the Achievements tile appear together.
   */
  showMedal?: boolean;
}

/**
 * `NavGroup.gradient` stays the public API — RoleBasedDashboard and
 * SchoolAdminCommandCenter both pass it — but it now selects a design-system
 * `Tone` rather than a raw Tailwind gradient pair.
 *
 * The old full-bleed `from-blue-500 to-indigo-600` discs were the loud
 * GradientKPICard treatment the design system deprecated in Phase 5: raw
 * palette values that define no token and so never flip for dark mode. Tinted
 * discs are what StatTile, FeatureTile and EmptyState already use everywhere
 * else, so the hub now matches the rest of the app instead of shouting over it.
 *
 * One tone per GROUP, not per tile: the group heading and its colour say the
 * same thing, and six saturated hues in one row is the "nothing signals which
 * number matters" failure documented on HeroCard.
 *
 * The tones are the Clay School banner's colours (2026-09-29, clay tiles):
 * "blue" groups (Exams) take the teal of the school roofs, so the hub reads as
 * the same world as the banner above it.
 */
const toneMap: Record<NavGroup["gradient"], Tone> = {
  purple: "violet",
  blue: "teal",
  emerald: "mint",
  amber: "peach",
};

export function NavigationHub({
  roleName,
  navGroups,
  showCheckIn = false,
  actionsView,
  showMedal = false,
  today,
}: NavigationHubProps) {
  const { data: profile } = useProfileData();
  const { data: roleInfo } = useUserRole();
  const { isManagingInstitution } = useInstitutionContext();
  const { isFeatureEnabled } = useInstitutionFeatures();

  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const institutionName = profile?.institution?.name;
  const greeting = useRotatingGreeting();

  // Mirror AppSidebar's gating rule: filter by institution features for any
  // institution-bound role, and for super-admin only when managing an institution.
  const shouldFilterByFeatures =
    roleInfo?.isSchoolAdmin ||
    roleInfo?.isTeacher ||
    roleInfo?.isCoordinator ||
    roleInfo?.isStudent ||
    (roleInfo?.isSuperAdmin && isManagingInstitution);

  const visibleGroups = navGroups
    .map((group) => ({
      ...group,
      items: shouldFilterByFeatures
        ? group.items.filter((item) => {
            const featureId = FEATURE_URL_MAP[item.url];
            return !featureId || isFeatureEnabled(featureId);
          })
        : group.items,
    }))
    .filter((group) => group.items.length > 0);

  // Same rule the Attendance tile passes through above, so the card and the
  // tile appear and disappear together.
  const attendanceFeatureId = FEATURE_URL_MAP["/school/attendance"];
  const checkInVisible =
    showCheckIn && (!shouldFilterByFeatures || !attendanceFeatureId || isFeatureEnabled(attendanceFeatureId));

  return (
    <PageShell>
      {/* The day's action cards when something is due, else the Clay School banner. */}
      {actionsView ? <DashboardTopSlot view={actionsView} /> : <SchoolSceneIllustration />}

      {/* CoachPro-style header: small eyebrow + bold h1 + subtle subtitle.
          Matches the coordinator + student dashboards.
          Desktop polish: more vertical breathing room above and below. */}
      <header className="pt-3 pb-2 sm:pt-4 sm:pb-3 lg:pt-6 lg:pb-6">
        {/* The eyebrow row carries the one small teal check-in button at its
            right end, so it sits top-right of the greeting at every width
            instead of floating alone under the subtitle. */}
        <div className="flex items-center justify-between gap-3">
          <p className="eyebrow">Welcome back</p>
          {checkInVisible && <StaffCheckInCard compact view={actionsView} />}
        </div>
        <h1 className="text-[28px] sm:text-[34px] lg:text-[42px] xl:text-[46px] leading-tight font-bold tracking-tight text-ink-900 mt-1.5">
          {greeting}, {firstName}!
        </h1>
        {/* The subtitle and, for teachers, the medal chip on the same line
            (wrapping under it on a narrow phone). The chip renders nothing
            when the school's badge set is off. */}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm sm:text-[15px] text-ink-600">
            {roleName}
            {institutionName && <span> · {institutionName}</span>}
          </p>
          {showMedal && <MedalChip />}
        </div>
      </header>

      {today && <div className="mb-8 lg:mb-12">{today}</div>}

      {/* Navigation Groups — generous vertical rhythm on desktop. */}
      {visibleGroups.map((group, groupIdx) => (
        <div key={group.group} className="mt-8 lg:mt-12 first:mt-0">
          <motion.h2
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + groupIdx * 0.08 }}
            /* Matches the section labels on the Coordinator dashboard so the two
               hubs read as one system. text-ink-400 flips with dark mode;
               text-muted-foreground was fine but the ink scale is the rule. */
            className="text-xs font-medium uppercase tracking-wider text-ink-400"
          >
            {group.group}
          </motion.h2>
          <StaggerContainer
            /* items-stretch + h-full below: tiles in a row previously sized to
               their own content, so a wrapped title ("Homework and Assignment")
               or a two-line description ("Question Bank") left the row visibly
               ragged. Every card in a row is now the height of the tallest. */
            className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 items-stretch"
            staggerDelay={0.06}
          >
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <StaggerItem key={item.url} className="h-full">
                  {/* FeatureTile is the design system's grid-tile primitive
                      (surface-card + frosted-shadow + tinted disc + ink scale),
                      and it renders a real <Link>. The hand-rolled card this
                      replaced was a div with onClick: not keyboard reachable,
                      and ctrl/middle-click could not open a tab. */}
                  <FeatureTile
                    to={item.url}
                    icon={<Icon className="h-5 w-5" />}
                    title={item.title}
                    description={item.description}
                    tone={toneMap[group.gradient]}
                    className="h-full"
                  />
                </StaggerItem>
              );
            })}
          </StaggerContainer>
        </div>
      ))}
    </PageShell>
  );
}
