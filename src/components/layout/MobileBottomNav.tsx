import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Home, Layers, Menu, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSidebar } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { isNativePlatform } from "@/lib/native";
import { cn } from "@/lib/utils";
import { GROUP_ICONS, activeNavUrl, useNavGroups, type NavGroup } from "./useNavGroups";

/**
 * Phone bottom tab bar (Instagram / Airtel Thanks / MakeMyTrip pattern).
 *
 * Built from the SAME groups the sidebar renders (useNavGroups), on Tushar's
 * rule (2026-10-21): the bar is the sidebar's first four entries, Home plus
 * the first three sections, and "More" holds the sections that are left. A
 * section tab lands on that section's first page; its other pages appear as
 * tabs inside the page (SectionTabs). Phones only: the desktop sidebar keeps
 * the full list.
 *
 * Because the tabs come from useNavGroups, they inherit its role, override
 * and feature gating, so a disabled module can never grow a ghost tab
 * (ui-invariants skill §2).
 */

export interface BottomNavItem {
  /** The sidebar group this tab stands for. */
  group: string;
  title: string;
  /** Where the tab lands: the group's first page. */
  url: string;
  /** Every page in the group; any of them lights this tab. */
  urls: string[];
  icon: LucideIcon;
}

/** Home plus the first three sections. */
export const BAR_GROUPS = 4;

/** Short labels for section names that do not fit under an icon. */
const BAR_LABELS: Record<string, string> = {
  Main: "Home",
  "School Management": "School",
  "Diary & Notices": "Diary",
  Administration: "Admin",
};

function toBarItem(g: NavGroup): BottomNavItem {
  return {
    group: g.group,
    title: BAR_LABELS[g.group] ?? g.group,
    url: g.items[0].url,
    urls: g.items.map((i) => i.url),
    icon: g.group === "Main" ? Home : (GROUP_ICONS[g.group] ?? Layers),
  };
}

/**
 * Warms a tab's page chunk before the tap lands, so the page swaps in without
 * the "Loading..." fallback. Each import names the SAME module App.tsx lazy
 * loads, so Vite resolves it to the same chunk and nothing is downloaded twice.
 * A landing page missing here still works, it just is not warmed.
 */
const PREFETCH: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("@/pages/Dashboard"),
  "/student/my-week": () => import("@/pages/student/StudentWeekPageV2"),
  "/student/homework": () => import("@/pages/student/StudentHomeworkPage"),
  "/student/exams": () => import("@/pages/student/StudentExamsPage"),
  "/student/results": () => import("@/pages/student/StudentResultsPage"),
  "/teacher/my-week": () => import("@/pages/teacher/TeacherMyWeekPageV2"),
  "/achievements": () => import("@/pages/AchievementsPage"),
  "/school/syllabus": () => import("@/pages/school/SchoolSyllabusPage"),
  "/homework": () => import("@/pages/HomeworkPage"),
  "/exams": () => import("@/pages/ExamsPage"),
  "/coordinator/exams": () => import("@/pages/ExamsPage"),
  "/school/attendance": () => import("@/pages/school/SchoolAttendancePage"),
  "/coordinator/classes": () => import("@/pages/school/SchoolClassesPage"),
  "/school/users": () => import("@/pages/school/ManageUsersPage"),
  "/school/fees": () => import("@/pages/school/FeesManagementPage"),
  "/admin/institutions": () => import("@/pages/admin/InstitutionsPage"),
  "/admin/users": () => import("@/pages/admin/UsersPage"),
  "/admin/analytics": () => import("@/pages/AnalyticsPage"),
};

const prefetched = new Set<string>();
function prefetch(url: string) {
  if (prefetched.has(url)) return;
  const load = PREFETCH[url];
  if (!load) return;
  prefetched.add(url);
  // A failed warm-up is harmless: the real navigation retries the import.
  load().catch(() => prefetched.delete(url));
}

/**
 * Focused flows hide the bar, the way Instagram hides it while you compose:
 * they own the bottom edge (sticky Save / Submit footers) or must not be left
 * by accident (exam attempts).
 */
const HIDDEN_ON: RegExp[] = [
  /\/create(\/|$)/,
  /\/edit\//,
  /\/attempt$/,
  /\/evaluate\//,
  /\/offline-marks$/,
  /^\/student\/hybrid-exam\//,
  /^\/student\/olympiad\/(exam|pin-entry)/,
  /^\/evaluations\/hybrid\/[^/]+$/,
  /^\/homework\/[^/]+$/,
  /^\/proctoring\//,
];

/** A focused flow (create, edit, attempt, marking): no bar, no section tabs. */
export function isFocusedFlow(pathname: string): boolean {
  return HIDDEN_ON.some((re) => re.test(pathname));
}

/**
 * The tabs for the signed-in user, or null when the bar should not show
 * (desktop, a focused flow, or fewer than two sections to switch between).
 */
export function useBottomNavItems(): BottomNavItem[] | null {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  const groups = useNavGroups();

  return useMemo(() => {
    if (!isMobile) return null;
    if (isFocusedFlow(pathname)) return null;
    // The command center pins its own section strip to the bottom edge inside
    // the app (index.css, .native-shell .native-bottom-bar).
    if (isNativePlatform() && pathname.startsWith("/school/command-center")) return null;
    const items = groups.filter((g) => g.items.length > 0).slice(0, BAR_GROUPS).map(toBarItem);
    // Olympiad-only schools have a single entry; a bar would add nothing.
    return items.length > 1 ? items : null;
  }, [isMobile, pathname, groups]);
}

/** The tab owning the most specific nav url for this path, or -1. */
function activeIndexFor(items: BottomNavItem[], groups: NavGroup[], pathname: string): number {
  const url = activeNavUrl(groups, pathname);
  if (!url) return -1;
  return items.findIndex((item) => item.urls.includes(url));
}

// Written out in full so Tailwind keeps them (it cannot see built strings).
// A bar has 3 to 5 slots: up to four tabs plus "More".
const GRID_COLS: Record<number, string> = { 3: "grid-cols-3", 4: "grid-cols-4", 5: "grid-cols-5" };
const SLOT_WIDTH: Record<number, string> = { 3: "w-1/3", 4: "w-1/4", 5: "w-1/5" };
const SLOT_OFFSET = [
  "translate-x-0",
  "translate-x-full",
  "translate-x-[200%]",
  "translate-x-[300%]",
  "translate-x-[400%]",
];

// ProtectedRoute remounts AppLayout, and with it this bar, on every route
// change. The tab you came from is kept here so the indicator can slide from
// it to the new tab instead of appearing in place.
let lastActiveIndex = -1;

export function MobileBottomNav({ items }: { items: BottomNavItem[] }) {
  const { pathname } = useLocation();
  const { openMobile, setOpenMobile } = useSidebar();
  const groups = useNavGroups();
  const activeIndex = activeIndexFor(items, groups, pathname);
  const slots = items.length + 1; // + "More"

  const [indicatorIndex, setIndicatorIndex] = useState(() =>
    lastActiveIndex >= 0 && activeIndex >= 0 ? lastActiveIndex : activeIndex,
  );
  // The tab whose icon plays the "pop", set only when the active tab changes,
  // so a later re-render cannot cut the animation short.
  const [popIndex, setPopIndex] = useState(() =>
    activeIndex >= 0 && activeIndex !== lastActiveIndex ? activeIndex : -1,
  );
  const prevActive = useRef(activeIndex);
  useEffect(() => {
    if (prevActive.current === activeIndex) return;
    prevActive.current = activeIndex;
    setPopIndex(activeIndex);
  }, [activeIndex]);

  useLayoutEffect(() => {
    lastActiveIndex = activeIndex;
    if (indicatorIndex === activeIndex) return;
    // Paint once at the previous tab, then move, so the transition runs.
    const raf = requestAnimationFrame(() => setIndicatorIndex(activeIndex));
    return () => cancelAnimationFrame(raf);
  }, [activeIndex, indicatorIndex]);

  // Slide away while the on-screen keyboard is up; it would otherwise ride on
  // top of it and cover the field being typed in.
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    let blurTimer: number | undefined;
    const isTextField = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.isContentEditable ||
        el.tagName === "TEXTAREA" ||
        (el.tagName === "INPUT" &&
          !["checkbox", "radio", "button", "submit", "range", "file", "color"].includes(
            (el as HTMLInputElement).type,
          )));
    const onFocusIn = (e: FocusEvent) => {
      if (!isTextField(e.target)) return;
      window.clearTimeout(blurTimer);
      setTyping(true);
    };
    // Deferred, so tabbing from one field to the next does not flash the bar.
    const onFocusOut = () => {
      window.clearTimeout(blurTimer);
      blurTimer = window.setTimeout(() => setTyping(isTextField(document.activeElement)), 120);
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(blurTimer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  // Lets floating chrome (MobileFab) sit above the bar instead of under it.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(
      "--bottom-nav-height",
      typing ? "0px" : "calc(4rem + env(safe-area-inset-bottom, 0px))",
    );
    return () => {
      root.style.removeProperty("--bottom-nav-height");
    };
  }, [typing]);

  // Warm the other tabs once the page has settled, unless the user asked the
  // browser to save data.
  useEffect(() => {
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
      ?.saveData;
    if (saveData) return;
    const warm = () => items.forEach((item) => prefetch(item.url));
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(warm, { timeout: 4000 });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(warm, 2500);
    return () => window.clearTimeout(t);
  }, [items]);

  return (
    <nav
      aria-label="Primary"
      className={cn(
        "bottom-nav tab-strip-frost fixed inset-x-0 bottom-0 z-40 md:hidden",
        "pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)]",
        "transition-transform duration-200 ease-out motion-reduce:transition-none",
        typing && "translate-y-full",
      )}
    >
      <div className={cn("relative grid h-16", GRID_COLS[slots])}>
        {/* Sliding pill behind the active icon. */}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute left-0 top-2 flex h-8 justify-center",
            "transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none",
            SLOT_WIDTH[slots],
            SLOT_OFFSET[Math.max(indicatorIndex, 0)],
            indicatorIndex < 0 && "opacity-0",
          )}
        >
          <span className="h-8 w-14 rounded-full bg-brand-primary/15" />
        </span>

        {items.map((item, i) => {
          const active = i === activeIndex;
          const Icon = item.icon;
          return (
            <Button
              key={item.group}
              asChild
              variant="ghost"
              className="group relative h-full w-full flex-col gap-1 rounded-none p-0 hover:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0 [&_svg]:size-[22px]"
            >
              <Link
                to={item.url}
                aria-current={active ? "page" : undefined}
                onPointerDown={() => prefetch(item.url)}
                onFocus={() => prefetch(item.url)}
                onClick={(e) => {
                  // Instagram: tapping the tab you are on takes you to its top.
                  if (active) {
                    e.preventDefault();
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }
                }}
              >
                <span className="flex h-8 w-14 items-center justify-center transition-transform duration-150 group-active:scale-90">
                  <Icon
                    className={cn(
                      "transition-colors duration-200",
                      active ? "text-brand-primary" : "text-ink-500",
                      i === popIndex && "bottom-nav-pop",
                    )}
                    strokeWidth={active ? 2.4 : 1.9}
                  />
                </span>
                <span
                  className={cn(
                    "max-w-full truncate px-1 text-[11px] leading-none transition-colors duration-200",
                    active ? "font-semibold text-brand-primary" : "font-medium text-ink-500",
                  )}
                >
                  {item.title}
                </span>
              </Link>
            </Button>
          );
        })}

        <Button
          variant="ghost"
          aria-label="Open menu"
          aria-expanded={openMobile}
          onClick={() => setOpenMobile(true)}
          className="group relative h-full w-full flex-col gap-1 rounded-none p-0 hover:bg-transparent focus-visible:ring-inset focus-visible:ring-offset-0 [&_svg]:size-[22px]"
        >
          <span className="flex h-8 w-14 items-center justify-center transition-transform duration-150 group-active:scale-90">
            <Menu
              className={cn(
                "transition-colors duration-200",
                openMobile ? "text-brand-primary" : "text-ink-500",
              )}
              strokeWidth={openMobile ? 2.4 : 1.9}
            />
          </span>
          <span
            className={cn(
              "text-[11px] leading-none",
              openMobile ? "font-semibold text-brand-primary" : "font-medium text-ink-500",
            )}
          >
            More
          </span>
        </Button>
      </div>
    </nav>
  );
}
