import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { cn } from "@/lib/utils";
import { isNativePlatform } from "@/lib/native";
import { PageShell } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";
import { useAdminDigest, useDashEvents } from "@/hooks/dashboard/useAdminDashboardData";
import { useDash5Tree } from "@/hooks/dashboard/useDash5";

import { Dash5StatCards } from "@/components/command-center/v5/Dash5StatCards";
import { Dash5Tree } from "@/components/command-center/v5/Dash5Tree";
import {
  Dash5AdoptionAlert, Dash5AtRisk, Dash5ScoreDistribution, Dash5StudentTree,
} from "@/components/command-center/v5/Dash5Students";
import {
  Dash5Coordinators, Dash5TeacherActivity,
} from "@/components/command-center/v5/Dash5Teachers";
import {
  Dash5ClassPerformance, Dash5ExamScatter, Dash5SubjectPerformance, Dash5SyllabusCoverage,
} from "@/components/command-center/v5/Dash5Academics";
import {
  Dash5AttendanceByWing, Dash5AttendanceTrend, Dash5ChronicAbsentees, Dash5NeedsByWing,
} from "@/components/command-center/v5/Dash5Attendance";
import {
  Dash5ExamPipeline, Dash5TaskSuggestions,
} from "@/components/command-center/v5/Dash5Suggestions";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { CbseReportsModal } from "@/components/command-center/CbseReportsModal";
import type { CbseReportType } from "@/components/command-center/cbseReportTypes";
import { ReportsCenter } from "@/components/command-center/ReportsCenter";
import { REPORT_CATEGORIES, buildReportCatalog } from "@/components/command-center/reportCatalog";
import { useSchoolPerformanceReport } from "@/components/command-center/SchoolPerformanceReport";

// The lesson-plan sheet pulls in the Excel builder: only load it when asked.
const DownloadLessonPlanSheetV2 = lazy(() => import("@/components/timetable-v2/DownloadLessonPlanSheetV2"));
import { Dash5BandDonut } from "@/components/command-center/v5/Dash5BandDonut";
import {
  Dash5CommunicationHighlights, Dash5SchoolWideNeeds,
} from "@/components/command-center/v5/Dash5Communication";
import { LazySection } from "@/components/command-center/v5/LazySection";
import {
  SectionHead, V5Card, V5Empty, V5Error, V5Loading,
} from "@/components/command-center/v5/primitives";

/**
 * Admin Dashboard v5, built to public/report_reference/salci-admin-dashboard-v5.html.
 *
 * Under construction behind its own route while the old Command Center stays
 * live on /school/command-center. Sections appear here as their data lands, and
 * the tab strip lists only the sections that exist: an empty tab is a worse lie
 * than a missing one. The route swap happens once the page is whole.
 */

const SECTIONS = [
  { id: "sec-overview", label: "Overview" },
  { id: "sec-students", label: "Students" },
  { id: "sec-teachers", label: "Teachers & staff" },
  { id: "sec-academics", label: "Academics" },
  { id: "sec-attendance", label: "Attendance" },
  { id: "sec-needs", label: "Needs attention" },
  { id: "sec-communication", label: "Communication" },
];

export default function CommandCenterV5Page() {
  const tree = useDash5Tree("wings", null, null);
  const scope = tree.data?.scope;
  const nav = useNavigate();
  const [active, setActive] = useState(SECTIONS[0].id);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // In the app the tab strip is a fixed bar at the bottom of the screen, not a
  // strip pinned under the app bar; see the JSX below and index.css for why.
  // That moves the reading line, so it is decided once here.
  const bottomBar = isNativePlatform();
  // The status-bar inset, resolved from --safe-top. Constant for the life of
  // the page except on rotation, so it is measured once rather than per frame.
  const safeTopRef = useRef<number | null>(null);
  // The section a tap is travelling to. While set, the highlight is that
  // section and the page keeps re-aligning to it as content above it loads.
  const targetRef = useRef<string | null>(null);
  const quietTimer = useRef<number | undefined>(undefined);
  // Every section up to this index mounts immediately instead of waiting to
  // scroll into view. Only ever grows.
  const [revealUpTo, setRevealUpTo] = useState(0);

  // The line a heading has to cross to count as "the section you are in". Taken
  // from the strip itself, so it follows the app bar up when that hides and the
  // jump target and the spy can never be measured against different rulers.
  const readingLine = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return 105 + 8;
    // Bottom bar: the strip no longer marks the top of the readable area, so
    // measuring from it would put the reading line at the FOOT of the screen.
    // A section would count as current only once it had scrolled almost out of
    // sight, and tapping a tab would park its heading at the bottom edge. The
    // line is a short way below the status bar instead, which is where a
    // heading should land when you jump to it. --safe-top is published by
    // index.css because env() cannot be read from script.
    if (bottomBar) {
      if (safeTopRef.current === null) {
        safeTopRef.current =
          parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0;
      }
      return safeTopRef.current + 72;
    }
    const rect = strip.getBoundingClientRect();
    // Where the strip's lower edge WILL be once pinned, not where it is now.
    // In the app the strip starts below a bar that scrolls away, so at the top
    // of the page it sits lower than its pinned position, and a jump measured
    // there would land the heading under an empty band. Computed `top` is the
    // pin position with every var()/env() resolved.
    const pinnedTop = parseFloat(getComputedStyle(strip).top) || 0;
    return Math.min(rect.bottom, pinnedTop + rect.height) + 8;
  }, [bottomBar]);
  // Which CBSE report the Reports panel picked; null while closed.
  const [cbseType, setCbseType] = useState<CbseReportType | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);
  const [lessonPlanOpen, setLessonPlanOpen] = useState(false);
  const { isFeatureEnabled } = useInstitutionFeatures();
  const generateSchoolReport = useSchoolPerformanceReport();
  // Every report the school can download anywhere in SALCI, for the panel.
  const reports = useMemo(
    () => buildReportCatalog({
      openSchoolReport: () => void generateSchoolReport(),
      openCbse: (t) => setCbseType(t),
      openLessonPlan: () => setLessonPlanOpen(true),
      isFeatureEnabled,
    }),
    [isFeatureEnabled, generateSchoolReport],
  );

  const options = useMemo(() => SECTIONS.map((s) => ({ value: s.id, label: s.label })), []);

  // Which section am I in? The obvious IntersectionObserver version was wrong:
  // its callback receives only the entries that CHANGED, and reading that batch
  // as if it were the whole picture let a single section crossing a boundary
  // hand the highlight to a tab whose content was nowhere near the screen. It
  // showed "Students" while Overview filled the viewport.
  //
  // This asks the question directly instead: the current section is the LAST one
  // whose heading has passed under the pinned bars. That is monotonic with
  // scroll position, so it cannot flicker between two answers, and it behaves
  // identically going back up.
  //
  // The reading line is measured off the strip itself rather than hardcoded, so
  // it stays correct when the app bar hides and the strip rises into its place.
  useEffect(() => {
    let frame = 0;

    const pick = () => {
      frame = 0;
      // A tap owns the highlight until the page has stopped moving under it.
      if (targetRef.current) return;

      const doc = document.documentElement;
      // Only meaningful on a page that actually scrolls. Without the first
      // clause a page short enough to fit is "at the bottom" while sitting at
      // the top, and would light the last tab from the moment it loaded.
      const scrollable = doc.scrollHeight > window.innerHeight + 4;
      const atBottom = scrollable && window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      let current = SECTIONS[0].id;

      if (atBottom) {
        // The last section can never reach the reading line: there is not enough
        // page beneath it to scroll that far, so the browser stops at the bottom
        // and "the last heading that passed the line" is stuck one section
        // short. That is why tapping "Needs attention" landed on it correctly
        // and still lit Communication. At the bottom, the answer is the last
        // section that is on screen at all.
        for (const sec of SECTIONS) {
          const el = document.getElementById(sec.id);
          if (el && el.getBoundingClientRect().top < window.innerHeight) current = sec.id;
        }
      } else {
        const line = readingLine();
        for (const sec of SECTIONS) {
          const el = document.getElementById(sec.id);
          if (el && el.getBoundingClientRect().top <= line) current = sec.id;
        }
      }

      setActive((prev) => (prev === current ? prev : current));
    };

    // rAF-coalesced: at most one measurement per painted frame however fast the
    // wheel spins, and seven rect reads is nothing next to the queries on this
    // page. A bare scroll handler would be the thing CLAUDE.md 23 warns about.
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(pick); };

    // Rotation is the one thing that moves the status-bar inset: in landscape
    // it is 0 and the notch moves to a side. iOS updates env() a frame after
    // the event, so drop the cache and re-read on the next frame.
    const onGeometry = () => {
      safeTopRef.current = null;
      requestAnimationFrame(onScroll);
    };

    pick();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onGeometry, { passive: true });
    window.addEventListener("orientationchange", onGeometry, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onGeometry);
      window.removeEventListener("orientationchange", onGeometry);
    };
  }, [readingLine]);

  /** Scroll so the target heading sits just above the spy's reading line. */
  const alignToTarget = useCallback((behavior: ScrollBehavior) => {
    const id = targetRef.current;
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    const top = window.scrollY + el.getBoundingClientRect().top - (readingLine() - 8);
    window.scrollTo({ top: Math.max(0, top), behavior });
  }, [readingLine]);

  const releaseTarget = useCallback(() => {
    targetRef.current = null;
    window.clearTimeout(quietTimer.current);
  }, []);

  /**
   * THE bug behind every "the tab is wrong after I tap" report.
   *
   * Sections below the fold are 220px placeholders until they scroll into view.
   * A jump measured against those placeholders aims thousands of pixels short,
   * and as the scroll passes each one it mounts, grows, and the page sprawls out
   * UNDERNEATH an animation aimed at a stale pixel. It stops in the middle of
   * whichever section happened to be there, with the tapped tab still lit.
   *
   * So: reveal every section up to the target FIRST, let it lay out, then
   * measure. And because each section's data then arrives asynchronously and
   * grows its cards from skeletons, keep re-aligning the heading to the line
   * until the page stops moving, or the reader takes over the scroll.
   */
  const jump = (id: string) => {
    const idx = SECTIONS.findIndex((sec) => sec.id === id);
    if (idx < 0) return;
    setActive(id);
    targetRef.current = id;
    setRevealUpTo((i) => Math.max(i, idx));
    // Two frames: one for React to commit the reveal, one for layout to settle.
    requestAnimationFrame(() => requestAnimationFrame(() => alignToTarget("smooth")));
    // If nothing above the target ever resizes (all already loaded), the quiet
    // timer is what hands control back to the spy.
    window.clearTimeout(quietTimer.current);
    quietTimer.current = window.setTimeout(releaseTarget, 1500);
  };

  // While a jump is in flight, follow the target as content loads above it.
  // Instant corrections: they are a few pixels each as a skeleton becomes a
  // table, and animating them would look like the page fidgeting.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!targetRef.current) return;
      alignToTarget("instant");
      window.clearTimeout(quietTimer.current);
      quietTimer.current = window.setTimeout(releaseTarget, 1200);
    });
    ro.observe(root);
    // The reader takes over the moment they touch the scroll themselves.
    const opts: AddEventListenerOptions = { passive: true };
    window.addEventListener("wheel", releaseTarget, opts);
    window.addEventListener("touchstart", releaseTarget, opts);
    window.addEventListener("keydown", releaseTarget);
    return () => {
      ro.disconnect();
      window.clearTimeout(quietTimer.current);
      window.removeEventListener("wheel", releaseTarget);
      window.removeEventListener("touchstart", releaseTarget);
      window.removeEventListener("keydown", releaseTarget);
    };
  }, [alignToTarget, releaseTarget]);

  return (
    <PageShell contentClassName="max-w-none">
      <div
        ref={rootRef}
        className={cn(
          // Clear of the bottom bar in the app: its height plus the home
          // indicator, or the last card sits under it and cannot be read.
          bottomBar ? "pb-[calc(5.5rem+env(safe-area-inset-bottom,0px))]" : "pb-20",
        )}
      >
        {/* Pinned tab strip, so the section you are in and the way to another
            are always reachable. On the web it sits directly under the app bar
            and rides with it: --app-bar-offset is the bar's current height, 0
            once it has slid away, so the strip closes the gap and takes its
            place instead of hanging below an empty band, on the same 300ms
            curve the bar uses. In the app the bar is not pinned at all
            (AppLayout), the offset is 0 and the strip pins at the top edge once
            the bar has scrolled off. z-10 keeps it under the bar's z-20.

            tab-strip-frost, not app-bar-frost: same frost on the web, but the
            native block restyles .app-bar-frost as the teal app bar and the
            strip turned teal with it (2026-09-17 phone test).

            native-status-scrim: the app is edge to edge, so once the strip is
            pinned (below the status-bar inset, see --app-bar-offset) its
            surface is extended up behind the clock and icons (index.css). At
            rest the scrim is hidden under the app bar, which is flush above.

            IN THE APP THE STRIP IS A BOTTOM BAR (2026-09-23), because at the
            top it trembled while the page scrolled and nothing about the strip
            fixed it: not the backdrop blur, not any of its compositing
            properties, not even making it position:static. A static element
            trembling means the page's own scrolling is what moves, and a fixed
            element is the one arrangement immune to it. See index.css,
            .native-shell .native-bottom-bar. It also lands where a phone's
            thumb is, and clear of the clock, so it needs no status scrim there.

            Full-bleed on the web: the negative side margins cancel PageShell's
            gutter so the divider runs the whole content width, and the negative
            top margin cancels its top padding so the strip sits flush. The
            bottom bar sets its own margins and padding instead. */}
        <div
          ref={stripRef}
          // Sticky table headers park under this (TradTable stickyHeader).
          data-pinned-strip
          className={cn(
            "tab-strip-frost",
            bottomBar
              ? "native-bottom-bar"
              : [
                  "sticky z-10 native-status-scrim will-change-transform",
                  "top-[var(--app-bar-offset,var(--app-bar-height,61px))]",
                  "transition-[top] duration-300 ease-in-out motion-reduce:transition-none",
                  "-mt-4 sm:-mt-5 lg:-mt-8",
                  "-mx-4 sm:-mx-6 lg:-mx-10 xl:-mx-14",
                  "border-b border-surface-stroke",
                ].join(" "),
            "px-4 sm:px-6 lg:px-10 xl:px-14 py-2",
          )}
        >
          <MobileTabs value={active} onValueChange={jump} options={options} />
        </div>

        {/* One row, not two. The title and the report actions were stacked, so
            a band of vertical space went by before the first number appeared.
            They wrap to separate lines on a narrow screen on their own. */}
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pb-1 pt-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-ink-900">Dashboard</h1>
            {scope?.ay_start && scope?.ay_end && (
              <span className="text-[12.5px] font-semibold text-ink-500">
                Academic year {new Date(scope.ay_start).getFullYear()} to {new Date(scope.ay_end).getFullYear()}
              </span>
            )}
          </div>
          {/* Every report SALCI can produce, in one panel: the dashboard's own,
              the CBSE set, and the downloads that live on other pages. */}
          <div className="flex flex-none items-center gap-2">
            <Button onClick={() => setReportsOpen(true)}>
              <Download className="h-4 w-4" />
              Download report
            </Button>
          </div>
        </header>

        {/* ============================== OVERVIEW ============================== */}
        <section id="sec-overview" className="scroll-mt-[112px] pt-1">
          <Dash5StatCards />

          <SectionHead
            title="School performance"
            sub="Wings to classes to subjects to chapters. Every number below a row is the sum of the rows inside it."
          />
          <Dash5Tree />

          <SectionHead
            title="Insights by SALCI AI"
            sub="Derived each week from the same aggregates that drive the table above."
          />
          <InsightCards />

          <SectionHead
            title="Task suggestions by SALCI AI"
            sub="Drafts until you approve them. Highest priority first."
          />
          <Dash5TaskSuggestions />

          <SectionHead title="Events" sub="The next 30 days from the academic calendar." />
          <EventsCard />
        </section>

        {/* ============================== STUDENTS ============================== */}
        <LazySection id="sec-students" className="scroll-mt-[112px]" forceShow={revealUpTo >= 1}>
          <SectionHead
            title="Are your students using SALCI?"
            sub="Adoption is the leading indicator for everything else on this page."
          />
          <Dash5AdoptionAlert />
          <Dash5StudentTree />

          <SectionHead
            title="Where students stand"
            sub="The whole roster by band on the left, the spread of year averages on the right."
          />
          <div className="grid gap-4 lg:grid-cols-2">
            <Dash5BandDonut />
            <Dash5ScoreDistribution />
          </div>

          <Dash5AtRisk />
        </LazySection>

        {/* ============================== TEACHERS ============================== */}
        <LazySection id="sec-teachers" className="scroll-mt-[112px]" forceShow={revealUpTo >= 2}>
          <SectionHead
            title="Teachers & staff"
            sub="Least active first, so the teachers who need a nudge are at the top."
          />
          <Dash5TeacherActivity />
          <Dash5Coordinators />
        </LazySection>

        {/* ============================= ACADEMICS ============================== */}
        <LazySection id="sec-academics" className="scroll-mt-[112px]" forceShow={revealUpTo >= 3}>
          <SectionHead
            title="Class-wise average performance"
            sub="Starts at wing level. Click a bar to open its classes, then a class to see its subjects."
          />
          <Dash5ClassPerformance />

          <SectionHead title="Exam performance over time" sub="One dot per paper." />
          <Dash5ExamScatter />

          <SectionHead title="Subjects" sub="Where the school is strongest and weakest." />
          <Dash5SubjectPerformance />

          <SectionHead title="Exam pipeline" sub="Papers planned for the year against what has been held." />
          <Dash5ExamPipeline />

          <SectionHead
            title="Syllabus coverage"
            sub="Chapters done, partly done and not started. Drill from wings to classes."
          />
          <Dash5SyllabusCoverage />
        </LazySection>

        {/* ============================ ATTENDANCE ============================== */}
        <LazySection id="sec-attendance" className="scroll-mt-[112px]" forceShow={revealUpTo >= 4}>
          <SectionHead title="Attendance" sub="The last twenty days the school took a register." />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Dash5AttendanceTrend />
            <Dash5AttendanceByWing />
          </div>

          <SectionHead
            title="Chronic absentees"
            sub="Recomputed from the register over the window you pick, so a threshold means what it says."
          />
          <Dash5ChronicAbsentees />
        </LazySection>

        {/* ============================== NEEDS ================================= */}
        <LazySection id="sec-needs" className="scroll-mt-[112px]" forceShow={revealUpTo >= 5}>
          <SectionHead
            title="Needs your attention"
            sub="Open items counted per wing, so each one lands with the person who can act on it."
          />
          <Dash5NeedsByWing onGoto={jump} />
          <Dash5SchoolWideNeeds onGoto={jump} />
        </LazySection>

        {/* ========================== COMMUNICATION ============================= */}
        <LazySection id="sec-communication" className="scroll-mt-[112px]" forceShow={revealUpTo >= 6}>
          {/* Not a section of its own any more, one card that hands off. The
              Communication page already owns notices, the diary, PTM and
              messages in full; repeating a slice of it here was a second place
              to keep in step. This row carries the headline figures and the
              click. */}
          <V5Card className="mb-8 overflow-hidden">
            <button
              type="button"
              onClick={() => nav("/school/communication")}
              className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-stroke/40 sm:px-[18px]"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">
                  Communication
                </span>
                <span className="mt-0.5 block text-xs font-medium text-ink-500">
                  Circulars, meetings and what actually reached people.
                </span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                  <Dash5CommunicationHighlights />
                </span>
              </span>
            </button>
          </V5Card>
        </LazySection>
      </div>

      {/* Mounted only when opened: the CBSE report is a large fan-out and must
          never run on dashboard load. */}
      <ReportsCenter
        open={reportsOpen}
        onOpenChange={setReportsOpen}
        categories={REPORT_CATEGORIES}
        items={reports}
      />
      {lessonPlanOpen && (
        <Suspense fallback={null}>
          <DownloadLessonPlanSheetV2 open={lessonPlanOpen} onOpenChange={setLessonPlanOpen} />
        </Suspense>
      )}
      {cbseType && (
        <CbseReportsModal
          open={!!cbseType}
          onOpenChange={(v) => { if (!v) setCbseType(null); }}
          initialType={cbseType}
        />
      )}
    </PageShell>
  );
}

/* --------------------------------------------------------------- insights - */

const INSIGHT_TONE: Record<string, { word: string; glyph: string; varName: string }> = {
  high:   { word: "Risk",     glyph: "■", varName: "--dash-critical" },
  medium: { word: "Data gap", glyph: "◆", varName: "--dash-warning" },
  low:    { word: "Working",  glyph: "●", varName: "--dash-exc" },
};

/** One full row of the four-across grid. Anything past it is behind the toggle. */
const INSIGHTS_TOP = 4;

function InsightCards() {
  const digest = useAdminDigest();
  const [all, setAll] = useState(false);

  if (digest.isLoading) return <V5Loading label="Working out what changed…" />;
  if (digest.isError) {
    return <V5Error label="Couldn't build this week's insights." onRetry={() => void digest.refetch()} />;
  }
  const rows = digest.data ?? [];
  if (rows.length === 0) {
    return <V5Empty title="Nothing stands out this week" sub="Insights appear here when a number moves enough to be worth reading." />;
  }

  // The grid is four across, so a fifth card starts a second row that is mostly
  // empty space. Showing exactly one row keeps the section from pushing the rest
  // of the page down for one stray insight.
  const shown = all ? rows : rows.slice(0, INSIGHTS_TOP);

  return (
    <>
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {shown.map((b) => {
        const t = INSIGHT_TONE[b.severity] ?? INSIGHT_TONE.low;
        return (
          <div
            key={b.code}
            className="surface-card frosted-shadow rounded-[13px] border border-surface-stroke px-3.5 py-3"
            style={{ borderTop: `3px solid hsl(var(${t.varName}))` }}
          >
            <div className="mb-1.5 flex items-center gap-1.5" style={{ color: `hsl(var(${t.varName}))` }}>
              <span className="text-[10px] leading-none" aria-hidden>{t.glyph}</span>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.08em]">{t.word}</span>
            </div>
            <p className="m-0 text-[13px] font-bold leading-[1.35] tracking-[-0.015em] text-ink-900">{b.headline}</p>
            {b.detail && <p className="m-0 mt-1.5 text-[11.5px] font-medium leading-[1.5] text-ink-500">{b.detail}</p>}
          </div>
        );
      })}
    </div>

    {rows.length > INSIGHTS_TOP ? (
      <button
        type="button"
        onClick={() => setAll((v) => !v)}
        className="mb-6 mt-3 w-full rounded-[10px] border border-surface-stroke py-2 text-center text-[12.5px] font-bold text-brand-primary transition-colors duration-200 hover:border-brand-primary hover:bg-brand-primary/[0.07]"
      >
        {all ? "Show less" : `Show all ${rows.length} insights`}
      </button>
    ) : (
      <div className="mb-6" />
    )}
    </>
  );
}

/* ----------------------------------------------------------------- events - */

function EventsCard() {
  const events = useDashEvents(8);
  // Collapsed by default, as in the reference. The calendar is context, not a
  // thing to act on, so it earns a summary bar and not eight rows of the page.
  const [open, setOpen] = useState(false);
  const upcoming = (events.data ?? []).filter((e) => e.is_upcoming);

  return (
    <V5Card className="mb-8 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-4 text-left hover:bg-surface-stroke/40 sm:px-[18px]"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2.5">
            <span className="text-[14.5px] font-bold tracking-[-0.015em] text-ink-900">Calendar</span>
            {events.data && (
              <span className="rounded-md bg-brand-secondary/12 px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.07em] text-brand-secondary">
                {upcoming.length} upcoming
              </span>
            )}
          </span>
          {/* The first few events as chips, so the bar answers "anything this
              week?" without being opened. */}
          <span className="mt-2 flex flex-wrap gap-1.5">
            {(upcoming.length ? upcoming : events.data ?? []).slice(0, 4).map((e) => (
              <span
                key={e.event_id}
                className="max-w-full truncate rounded-full border border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-600"
              >
                {new Date(e.starts_on).toLocaleDateString(undefined, { day: "numeric", month: "short" })} ·{" "}
                {e.title}
              </span>
            ))}
            {(events.data?.length ?? 0) > 4 && (
              <span className="rounded-full border border-dashed border-surface-stroke px-2.5 py-1 text-[11px] font-semibold text-ink-500">
                +{(events.data?.length ?? 0) - 4} more
              </span>
            )}
            {events.data && events.data.length === 0 && (
              <span className="text-[11.5px] font-medium text-ink-500">
                Nothing on the calendar in this window.
              </span>
            )}
          </span>
        </span>
        <span className={cn("text-xs text-ink-400 transition-transform", open && "rotate-90")} aria-hidden>▸</span>
      </button>

      {open && (
      <div className="border-t border-surface-stroke px-4 pb-4 pt-3 sm:px-[18px]">
        {events.isLoading ? (
          <V5Loading />
        ) : events.isError ? (
          <V5Error label="Couldn't load the calendar." onRetry={() => void events.refetch()} />
        ) : (events.data?.length ?? 0) === 0 ? (
          <V5Empty title="Nothing on the calendar in this window" />
        ) : (
          <ul className="m-0 list-none divide-y divide-surface-stroke p-0">
            {events.data?.map((e) => {
              const d = new Date(e.starts_on);
              return (
                <li key={e.event_id} className="flex items-center gap-3 py-2.5">
                  <span className="flex w-[54px] flex-none flex-col items-center rounded-[9px] border border-surface-stroke bg-surface-stroke/40 py-1">
                    <span className="text-base font-extrabold leading-none text-ink-900">{d.getDate()}</span>
                    <span className="text-[9.5px] font-bold uppercase tracking-[0.06em] text-ink-400">
                      {d.toLocaleDateString(undefined, { month: "short" })}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-ink-900">{e.title}</span>
                    <span className="block text-[11.5px] font-medium text-ink-500">
                      {d.toLocaleDateString(undefined, { weekday: "long" })}
                      {!e.is_upcoming && " · already passed"}
                    </span>
                  </span>
                  {/* The kind, which is what the reference puts here. Upcoming
                      or past is already legible from the date beside it. */}
                  <span className="whitespace-nowrap rounded-full border border-surface-stroke px-2 py-[3px] text-[10.5px] font-extrabold uppercase tracking-[0.03em] text-ink-500">
                    {e.kind}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      )}
    </V5Card>
  );
}
