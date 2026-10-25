import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { PageShell } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";
import {
  coordCardsQuery, coordDeskQuery, coordSuggestionsQuery, useCoordScope,
} from "@/hooks/dashboard/useCoord";
import { dash5FilterOptionsQuery } from "@/hooks/dashboard/useDash5";

import { WingLockProvider } from "@/components/command-center/v5/WingLock";
import { LazySection } from "@/components/command-center/v5/LazySection";
import { SectionHead, V5Error, V5Loading } from "@/components/command-center/v5/primitives";
import { Dash5Tree } from "@/components/command-center/v5/Dash5Tree";
import {
  Dash5AdoptionAlert, Dash5AtRisk, Dash5ScoreDistribution, Dash5StudentTree,
} from "@/components/command-center/v5/Dash5Students";
import { Dash5BandDonut } from "@/components/command-center/v5/Dash5BandDonut";
import { Dash5TeacherActivity } from "@/components/command-center/v5/Dash5Teachers";
import {
  Dash5ClassPerformance, Dash5ExamScatter, Dash5SyllabusCoverage,
} from "@/components/command-center/v5/Dash5Academics";
import {
  Dash5AttendanceTrend, Dash5ChronicAbsentees, Dash5NeedsByWing,
} from "@/components/command-center/v5/Dash5Attendance";
import { Dash5ExamPipeline } from "@/components/command-center/v5/Dash5Suggestions";

import { CoordCards, CoordDesk, CoordScopeBar } from "@/components/command-center/coord/CoordOverview";
import { CoordClasses, CoordStaff } from "@/components/command-center/coord/CoordPeople";
import {
  CoordBacklog, CoordCover, CoordLessonPlans,
} from "@/components/command-center/coord/CoordTimetable";
import {
  CoordAttendanceByClass, CoordCommunication, CoordMyTasks, CoordSubjects, CoordSuggestions,
} from "@/components/command-center/coord/CoordSections";

/**
 * The Coordinator Console, built to
 * public/report_reference/salci-coordinator-dashboard2.html.
 *
 * HOW MUCH OF THIS IS NEW: less than it looks. Since migration 20260922100000
 * every dash5_* function clamps itself to dash5_caller_wing(), so the admin
 * dashboard's performance tree, student tree, band donut, exam scatter,
 * syllabus coverage and chronic-absentee cards are mounted here UNCHANGED and
 * answer about one wing. What is written fresh is only what an admin has no
 * equivalent of: the desk, the timetable plane, the wing's staff, and the tasks
 * pushed down from the principal.
 *
 * A wing is not a filter a coordinator chose, it is who they are, so the wing
 * pickers on the reused cards are suppressed by WingLockProvider and the wing
 * is stated once, in the header.
 *
 * The reference's top-level structure is kept: one scrolling page with a pinned
 * tab strip, rather than the separate "Communication page" it draws, which the
 * admin console already settled as a hand-off card (there is one full
 * Communication surface at /school/communication, and two would drift).
 */

const SECTIONS = [
  { id: "sec-overview", label: "Overview" },
  { id: "sec-students", label: "Students" },
  { id: "sec-teachers", label: "Teachers & staff" },
  { id: "sec-academics", label: "Academics" },
  { id: "sec-attendance", label: "Attendance" },
  { id: "sec-timetable", label: "Timetable & cover" },
  { id: "sec-needs", label: "Needs attention" },
];

export default function CoordinatorConsolePage() {
  const scope = useCoordScope();
  const queryClient = useQueryClient();

  // Every card below mounts only once dash5_coord_scope has resolved, so on
  // their own their RPCs start one full round trip late. These four take no
  // wing id (the server resolves it from auth.uid()), so they are started here,
  // alongside the scope call. The option objects are the ones the hooks use, so
  // the cards attach to these same fetches (or their cached results) when they
  // mount. None of the four hooks has an `enabled` condition to mirror.
  // prefetchQuery never throws. A prefetch still in flight when its card
  // mounts is shared, not repeated; one that already failed is fetched again
  // on mount (React Query's retryOnMount) and the card renders that answer,
  // error state included, as it always has.
  useEffect(() => {
    void queryClient.prefetchQuery(coordCardsQuery);
    void queryClient.prefetchQuery(coordDeskQuery);
    void queryClient.prefetchQuery(coordSuggestionsQuery);
    void queryClient.prefetchQuery(dash5FilterOptionsQuery);
  }, [queryClient]);

  const [active, setActive] = useState(SECTIONS[0].id);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const targetRef = useRef<string | null>(null);
  const quietTimer = useRef<number | undefined>(undefined);
  const [revealUpTo, setRevealUpTo] = useState(0);

  // The line a heading has to cross to count as "the section you are in",
  // measured off the strip itself so the jump target and the scroll spy can
  // never be measured against different rulers. Same contract as the admin
  // console; see CommandCenterV5Page for the full reasoning.
  const readingLine = useCallback(() => {
    const strip = stripRef.current;
    if (!strip) return 113;
    const rect = strip.getBoundingClientRect();
    const pinnedTop = parseFloat(getComputedStyle(strip).top) || 0;
    return Math.min(rect.bottom, pinnedTop + rect.height) + 8;
  }, []);

  const options = useMemo(() => SECTIONS.map((s) => ({ value: s.id, label: s.label })), []);

  const jump = useCallback((id: string) => {
    const idx = SECTIONS.findIndex((s) => s.id === id);
    // Everything above the target has to be mounted before we can measure
    // where the target is: a LazySection still holding its placeholder is the
    // wrong height, and the scroll lands short.
    if (idx > 0) setRevealUpTo((n) => Math.max(n, idx));
    setActive(id);
    targetRef.current = id;
    const align = () => {
      const el = document.getElementById(id);
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY - readingLine();
      window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
    };
    align();
    // Re-align as content above finishes loading and changes the page height.
    window.clearTimeout(quietTimer.current);
    let n = 0;
    const iv = window.setInterval(() => {
      align();
      if (++n >= 6) window.clearInterval(iv);
    }, 180);
    quietTimer.current = window.setTimeout(() => {
      window.clearInterval(iv);
      targetRef.current = null;
    }, 1300);
  }, [readingLine]);

  useEffect(() => {
    const onScroll = () => {
      if (targetRef.current) return;
      const line = readingLine();
      let current = SECTIONS[0].id;
      for (const s of SECTIONS) {
        const el = document.getElementById(s.id);
        if (el && el.getBoundingClientRect().top <= line + 1) current = s.id;
      }
      setActive(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [readingLine]);

  useEffect(() => () => {
    window.clearTimeout(quietTimer.current);
  }, []);

  const wingId = scope.data?.wing_id ?? null;

  return (
    <PageShell contentClassName="max-w-none">
      <div className="pb-20">
        {/* Same pinned strip as the admin console, including the native-shell
            handling: see CommandCenterV5Page for why each class is here. */}
        <div
          ref={stripRef}
          // Sticky table headers park under this (TradTable stickyHeader).
          data-pinned-strip
          className={cn(
            "sticky z-10 tab-strip-frost native-status-scrim will-change-transform",
            "top-[var(--app-bar-offset,var(--app-bar-height,61px))]",
            "transition-[top] duration-300 ease-in-out motion-reduce:transition-none",
            "-mt-4 sm:-mt-5 lg:-mt-8",
            "-mx-4 sm:-mx-6 lg:-mx-10 xl:-mx-14",
            "border-b border-surface-stroke px-4 sm:px-6 lg:px-10 xl:px-14 py-2",
          )}
        >
          <MobileTabs value={active} onValueChange={jump} options={options} />
        </div>

        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 pb-1 pt-4">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
            <h1 className="text-[22px] font-extrabold tracking-[-0.03em] text-ink-900">
              {scope.data?.wing_name ?? "Your wing"}
            </h1>
            {scope.data?.wing_span && (
              <span className="text-[12.5px] font-semibold text-ink-500">
                {scope.data.wing_span}
              </span>
            )}
            {scope.data?.ay_code && (
              <span className="text-[12.5px] font-semibold text-ink-500">
                Academic year {scope.data.ay_code}
              </span>
            )}
          </div>
        </header>

        {/* The scope resolves the wing every card below is pinned to, so a
            failure here is the page, not a card. Error before empty. */}
        {scope.isLoading ? (
          <V5Loading label="Working out your wing…" />
        ) : scope.isError || !wingId ? (
          <V5Error
            label="Couldn't work out which wing you coordinate. Ask an administrator to check your wing assignment."
            onRetry={() => void scope.refetch()}
          />
        ) : (
          <WingLockProvider wingId={wingId}>
            {/* ============================ OVERVIEW ============================ */}
            <section id="sec-overview" className="scroll-mt-[112px] pt-1">
              <CoordScopeBar scope={scope.data} />
              <CoordCards />

              <SectionHead
                title="Your desk"
                sub="Work that is waiting on you, not on a teacher and not on the principal."
              />
              <CoordDesk />

              <SectionHead
                title="Wing performance"
                sub="Classes to subjects to chapters. Every number below a row is the sum of the rows inside it."
              />
              <Dash5Tree />

              <SectionHead
                title="Task suggestions by SALCI AI"
                sub="Drafts until you approve them. Every assignee is a teacher in your wing."
              />
              <CoordSuggestions />
            </section>

            {/* ============================ STUDENTS ============================ */}
            <LazySection id="sec-students" className="scroll-mt-[112px]" forceShow={revealUpTo >= 1}>
              <SectionHead
                title="Are your students using SALCI?"
                sub="Adoption is the leading indicator for everything else on this page."
              />
              <Dash5AdoptionAlert />
              <Dash5StudentTree />

              <SectionHead
                title="Where your students stand"
                sub="Your roster by band on the left, the spread of year averages on the right."
              />
              <div className="grid gap-4 lg:grid-cols-2">
                <Dash5BandDonut />
                <Dash5ScoreDistribution />
              </div>

              <Dash5AtRisk />
            </LazySection>

            {/* ============================ TEACHERS ============================ */}
            <LazySection id="sec-teachers" className="scroll-mt-[112px]" forceShow={revealUpTo >= 2}>
              <SectionHead
                title="Your teachers"
                sub="Everyone who takes a class in your wing, across every subject. Least active first."
              />
              <Dash5TeacherActivity />
              <CoordClasses />
              <CoordStaff />
            </LazySection>

            {/* =========================== ACADEMICS ============================ */}
            <LazySection id="sec-academics" className="scroll-mt-[112px]" forceShow={revealUpTo >= 3}>
              <SectionHead
                title="Class-wise average performance"
                sub="Your classes against each other. Click a bar to open its subjects."
              />
              <Dash5ClassPerformance />

              <SectionHead title="Exam performance over time" sub="One dot per paper held in your wing." />
              <Dash5ExamScatter />

              {/* CoordSubjects, not Dash5SubjectPerformance: the admin card reads
                  two dash_* RPCs that raise for a coordinator, and its
                  school-wide default is the wrong question here anyway. */}
              <SectionHead title="Subjects" sub="Where your wing is strongest and weakest." />
              <CoordSubjects />

              <SectionHead
                title="Exam pipeline"
                sub="Papers the year implies, against what has actually been held."
              />
              <Dash5ExamPipeline />

              <SectionHead
                title="Syllabus coverage"
                sub="Chapters done, partly done and not started. Drill from classes to subjects."
              />
              <Dash5SyllabusCoverage />

              <SectionHead
                title="Lesson plan backlog"
                sub="Periods whose lesson plan was never updated. The cheapest accuracy you can buy."
              />
              <CoordBacklog />
            </LazySection>

            {/* ========================== ATTENDANCE ============================ */}
            <LazySection id="sec-attendance" className="scroll-mt-[112px]" forceShow={revealUpTo >= 4}>
              <SectionHead
                title="Attendance"
                sub="The last twenty days your wing took a register, plus today's compliance."
              />
              <Dash5AttendanceTrend />
              <CoordAttendanceByClass />

              <SectionHead
                title="Chronic absentees"
                sub="Recomputed from the register over the window you pick, so a threshold means what it says."
              />
              <Dash5ChronicAbsentees />
            </LazySection>

            {/* ======================== TIMETABLE & COVER ======================= */}
            <LazySection id="sec-timetable" className="scroll-mt-[112px]" forceShow={revealUpTo >= 5}>
              <SectionHead
                title="Timetable & substitution"
                sub="The wing timetable is yours to patch. This is the one surface where you outrank the admin day to day."
              />
              <CoordCover />
              {/* The lesson-plan day view, which replaced the reference's slot
                  grid on 2026-09-23: the question is whether each period's
                  lesson plan was updated, not how the timetable is staffed. */}
              <CoordLessonPlans />
            </LazySection>

            {/* ============================== NEEDS ============================= */}
            <LazySection id="sec-needs" className="scroll-mt-[112px]" forceShow={revealUpTo >= 6}>
              <SectionHead
                title="Needs your attention"
                sub="Every open item in your wing, counted from the same rollups as the rest of this page."
              />
              <Dash5NeedsByWing onGoto={jump} />

              <SectionHead
                title="From the principal"
                sub="What has been pushed down to you, soonest due first."
              />
              <CoordMyTasks />

              <CoordCommunication />
            </LazySection>
          </WingLockProvider>
        )}
      </div>
    </PageShell>
  );
}
