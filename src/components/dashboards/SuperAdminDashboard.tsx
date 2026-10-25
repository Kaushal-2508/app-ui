import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { StaggerContainer, StaggerItem } from "@/components/ui/animated-container";
import { PageShell } from "@/components/shared/page";
import { SchoolSceneIllustration } from "@/components/shared/illustrations";
import { TONES, type Tone } from "@/components/shared/design-system";
import { useProfileData } from "@/hooks/useProfileData";
import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionContext } from "@/contexts/InstitutionContext";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { FEATURE_URL_MAP } from "@/components/admin/institution-wizard/featuresData";
import { useRotatingGreeting } from "@/hooks/useRotatingGreeting";
import { cn } from "@/lib/utils";
import type { NavGroup } from "./NavigationHub";

// --------------------------------------------------------------
// SuperAdminDashboard: the /dashboard landing for super_admin ONLY.
//
// Same content as NavigationHub (same nav groups, same feature gating when
// managing an institution, same greeting pattern from the design system) but
// a layered treatment instead of a flat grid of identical boxes:
//   * a quick-jump pill row under the greeting for the four places a super
//     admin opens most,
//   * each group inside a softly tinted panel with a tone dot, a one-line
//     purpose and an area count,
//   * bento tiles: the first tile of each group is the lead and spans two
//     columns; every tile carries a tinted corner wash, a ringed icon disc
//     and an arrow that reveals on hover.
// Every colour is a token (surface-card, ink scale, brand hues, tone tints),
// so dark mode flips without extra rules. No new data fetching: the hooks
// below are the ones NavigationHub already runs on this page.
// --------------------------------------------------------------

const toneMap: Record<NavGroup["gradient"], Tone> = {
  purple: "violet",
  blue: "sky",
  emerald: "mint",
  amber: "peach",
};

/** Corner wash, panel tint, dot and ring per tone. Full literal class strings
 *  so Tailwind's scanner sees them (a computed name like `${x}/[0.07]` is
 *  never generated and silently renders nothing); TONES only carries the
 *  disc bg/fg pair. */
const TONE_DECOR: Record<Tone, { wash: string; panel: string; dot: string; ring: string }> = {
  teal:   { wash: "from-brand-primary/20",   panel: "from-brand-primary/[0.07]",   dot: "bg-brand-primary",   ring: "ring-brand-primary/20" },
  violet: { wash: "from-brand-secondary/20", panel: "from-brand-secondary/[0.07]", dot: "bg-brand-secondary", ring: "ring-brand-secondary/20" },
  peach:  { wash: "from-brand-accent/20",    panel: "from-brand-accent/[0.07]",    dot: "bg-brand-accent",    ring: "ring-brand-accent/20" },
  mint:   { wash: "from-emerald-500/20",     panel: "from-emerald-500/[0.07]",     dot: "bg-emerald-500",     ring: "ring-emerald-500/20" },
  sky:    { wash: "from-sky-500/20",         panel: "from-sky-500/[0.07]",         dot: "bg-sky-500",         ring: "ring-sky-500/20" },
  rose:   { wash: "from-rose-500/20",        panel: "from-rose-500/[0.07]",        dot: "bg-rose-500",        ring: "ring-rose-500/20" },
};

const GROUP_BLURB: Record<string, string> = {
  Administration: "Set up and govern every school on the platform.",
  Monitoring: "Watch what is happening across all schools right now.",
};

/** The four destinations a super admin opens most, by URL. Order is the pill order. */
const QUICK_JUMP_URLS = ["/admin/issues", "/admin/institutions", "/admin/users", "/admin/activity"];

interface Props {
  navGroups: NavGroup[];
}

export function SuperAdminDashboard({ navGroups }: Props) {
  const { data: profile } = useProfileData();
  const { data: roleInfo } = useUserRole();
  const { isManagingInstitution } = useInstitutionContext();
  const { isFeatureEnabled } = useInstitutionFeatures();

  const firstName = profile?.full_name?.split(" ")[0] || "there";
  const institutionName = profile?.institution?.name;
  const greeting = useRotatingGreeting();

  // Same rule as NavigationHub and AppSidebar: a super admin is feature-gated
  // only while managing a specific institution.
  const shouldFilterByFeatures = !!roleInfo?.isSuperAdmin && isManagingInstitution;

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

  const allItems = visibleGroups.flatMap((g) => g.items);
  const quickJump = QUICK_JUMP_URLS
    .map((url) => allItems.find((i) => i.url === url))
    .filter((i): i is NonNullable<typeof i> => !!i);

  return (
    <PageShell>
      <SchoolSceneIllustration />

      <header className="pt-3 pb-2 sm:pt-4 sm:pb-3 lg:pt-6 lg:pb-4">
        <p className="eyebrow">Welcome back</p>
        <h1 className="text-[28px] sm:text-[34px] lg:text-[42px] xl:text-[46px] leading-tight font-bold tracking-tight text-ink-900 mt-1.5">
          {greeting}, {firstName}!
        </h1>
        <p className="mt-2 text-sm sm:text-[15px] text-ink-600">
          Super Admin
          {institutionName && <span> · {institutionName}</span>}
        </p>
      </header>

      {quickJump.length > 0 && (
        <nav aria-label="Quick jump" className="flex flex-wrap gap-2 pb-2">
          {quickJump.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.url}
                to={item.url}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full surface-card frosted-shadow px-4 py-2",
                  "text-sm font-medium text-ink-900 ring-1 ring-surface-stroke transition-colors duration-200",
                  "hover:ring-brand-primary/40 hover:text-brand-primary",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
                )}
              >
                <Icon className="h-4 w-4 text-brand-primary" />
                {item.title}
              </Link>
            );
          })}
        </nav>
      )}

      {visibleGroups.map((group, groupIdx) => {
        const tone = toneMap[group.gradient];
        const decor = TONE_DECOR[tone];
        return (
          <motion.section
            key={group.group}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.12 + groupIdx * 0.1, duration: 0.4 }}
            className={cn(
              "mt-6 lg:mt-8 rounded-card p-4 sm:p-5 lg:p-6",
              "border border-surface-stroke bg-gradient-to-br to-transparent",
              decor.panel,
            )}
          >
            <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-ink-400">
                  <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", decor.dot)} />
                  {group.group}
                </p>
                {GROUP_BLURB[group.group] && (
                  <p className="mt-1 text-sm text-ink-600">{GROUP_BLURB[group.group]}</p>
                )}
              </div>
              <span className="shrink-0 rounded-full bg-surface-card px-2.5 py-0.5 text-xs font-medium tabular-nums text-ink-500 ring-1 ring-surface-stroke">
                {group.items.length} {group.items.length === 1 ? "area" : "areas"}
              </span>
            </div>

            <StaggerContainer
              /* Four columns max: with the lead tile spanning two, Administration's
                 ten tiles fill 2+2 / 4 / 4 exactly. Five columns left one tile
                 orphaned on its own row. */
              className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4 items-stretch"
              staggerDelay={0.05}
            >
              {group.items.map((item, idx) => (
                <StaggerItem key={item.url} className={cn("h-full", idx === 0 && "col-span-2")}>
                  <ShowcaseTile item={item} tone={tone} lead={idx === 0} />
                </StaggerItem>
              ))}
            </StaggerContainer>
          </motion.section>
        );
      })}
    </PageShell>
  );
}

function ShowcaseTile({
  item,
  tone,
  lead,
}: {
  item: { title: string; url: string; icon: LucideIcon; description: string };
  tone: Tone;
  lead: boolean;
}) {
  const t = TONES[tone];
  const decor = TONE_DECOR[tone];
  const Icon = item.icon;
  return (
    <Link
      to={item.url}
      className={cn(
        "group relative block h-full overflow-hidden surface-card frosted-shadow rounded-2xl p-5",
        "ring-1 ring-surface-stroke transition-[transform,box-shadow] duration-200",
        "hover:-translate-y-0.5 hover:shadow-card-lg active:scale-[0.98]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
      )}
    >
      {/* Tinted corner wash: the one thing that makes these read as designed
          surfaces rather than white boxes. Sits behind the content. */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br to-transparent",
          decor.wash,
        )}
      />
      <span
        aria-hidden
        className={cn(
          "absolute right-4 top-4 inline-flex h-7 w-7 items-center justify-center rounded-full",
          "bg-surface-card text-ink-500 ring-1 ring-surface-stroke opacity-0 -translate-x-1",
          "transition-[opacity,transform] duration-200 group-hover:opacity-100 group-hover:translate-x-0",
        )}
      >
        <ArrowUpRight className="h-3.5 w-3.5" />
      </span>

      <div className={cn("relative flex h-full", lead ? "flex-col sm:flex-row sm:items-start sm:gap-5" : "flex-col")}>
        <span
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-xl ring-1 mb-4",
            lead ? "h-14 w-14 sm:mb-0" : "h-11 w-11",
            t.bg, t.fg, decor.ring,
          )}
        >
          <Icon className={lead ? "h-6 w-6" : "h-5 w-5"} />
        </span>
        <div className="min-w-0 space-y-1">
          <h3 className={cn("font-semibold text-ink-900", lead ? "text-[20px] leading-[26px]" : "text-[17px] leading-[22px]")}>
            {item.title}
          </h3>
          <p className={cn("text-ink-500", lead ? "text-sm leading-5" : "text-[13px] leading-[18px] line-clamp-2")}>
            {item.description}
          </p>
        </div>
      </div>
    </Link>
  );
}
