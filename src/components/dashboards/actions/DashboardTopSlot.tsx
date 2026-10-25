import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, LogIn, LogOut, RotateCw, UserPlus2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { StaffCheckSheets } from "@/components/attendance/StaffCheckSheets";
import { SchoolSceneIllustration } from "@/components/shared/illustrations";
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { useAttendancePassKick } from "@/hooks/useAttendancePassKick";
import { useInstitutionTimezone } from "@/hooks/useInstitutionTimezone";
import {
  useDashboardActionsRefresh,
  useMyDashboardActions,
  type MyDashboardActions,
} from "@/hooks/useMyDashboardActions";
import { useStaffCheckFlow, type StaffCheckFlow } from "@/hooks/useStaffCheckFlow";
import {
  COVER_LINK,
  checkInCopy,
  checkOutCopy,
  coverCopy,
  dueCards,
  leaveCopy,
  leaveLinks,
  schoolClock,
  type DashboardActions,
} from "@/lib/dashboardActions";
import { cn, formatClassName } from "@/lib/utils";
import { ACTION_PRIMARY as PRIMARY, ACTION_SECONDARY as SECONDARY } from "./actionCardStyles";
import { ActionCardDeck, SLOT_BOX, type DeckItem } from "./ActionCardDeck";

// The card's buttons are ghost Buttons restyled by index.css (white pill / glass). Icons inside
// a Button need no size or margin: the Button sizes them and spaces them (gap-2).

/** The banner's sky with nothing on it: shown while the answer is on its way, so the 3D
 *  scene never starts only to give way to cards a moment later. */
function SkyBox() {
  return (
    <div
      className={cn("relative w-full overflow-hidden rounded-card scene-banner border border-white/40 dark:border-white/10", SLOT_BOX)}
      aria-hidden
    />
  );
}

/** The banner as the slot shows it: the sky box usually came first and is the same
 *  gradient, so no second fade-in (`.scene-banner-anim` sits outside Tailwind's layers,
 *  hence the `!`). */
function Banner() {
  return <SchoolSceneIllustration className="!animate-none" />;
}

/** Error before empty (§6): a failed answer must never read as "nothing to do". The
 *  greeting button stays while this shows, so check-in and check-out remain possible. */
function ActionsErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <ActionCardDeck
      items={[
        {
          id: "error",
          tone: "rose",
          icon: <AlertTriangle />,
          eyebrow: "Today",
          title: "Couldn't load your day",
          detail: "Check your connection and try again.",
          actions: (
            <Button variant="ghost" className={SECONDARY} onClick={onRetry}>
              <RotateCw />
              Retry
            </Button>
          ),
        },
      ]}
    />
  );
}

function buildItems(a: DashboardActions, flow: StaffCheckFlow, nowHHMM: string): DeckItem[] {
  const items: DeckItem[] = [];
  for (const kind of dueCards(a)) {
    if (kind === "check_in" && a.checkIn) {
      const copy = checkInCopy(a.checkIn, nowHHMM);
      const absent = a.checkIn.state === "absent";
      items.push({
        id: kind,
        tone: absent ? "rose" : "teal",
        icon: absent ? <AlertTriangle /> : <LogIn />,
        eyebrow: "Attendance",
        title: copy.title,
        detail: copy.detail,
        actions: absent ? undefined : (
          <Button
            variant="ghost"
            className={PRIMARY}
            onClick={flow.checkIn}
            disabled={flow.checkingIn || flow.settingsLoading || !flow.institutionId}
          >
            <LogIn />
            {flow.checkingIn ? "Checking in…" : "Check in"}
          </Button>
        ),
      });
    } else if (kind === "cover" && a.cover) {
      const copy = coverCopy(a.cover, formatClassName);
      items.push({
        id: kind,
        tone: "peach",
        icon: <UserPlus2 />,
        eyebrow: "Substitution",
        title: copy.title,
        detail: copy.detail,
        actions: (
          <Button asChild variant="ghost" className={PRIMARY}>
            <Link to={COVER_LINK}>Assign</Link>
          </Button>
        ),
      });
    } else if (kind === "leave" && a.leave) {
      const copy = leaveCopy(a.leave);
      items.push({
        id: kind,
        tone: "violet",
        icon: <CalendarClock />,
        eyebrow: "Leave",
        title: copy.title,
        detail: copy.detail,
        actions: leaveLinks(a.leave).map((link, i) => (
          <Button key={link.to} asChild variant="ghost" className={i === 0 ? PRIMARY : SECONDARY}>
            <Link to={link.to}>{link.label}</Link>
          </Button>
        )),
      });
    } else if (kind === "check_out" && a.checkOut) {
      const copy = checkOutCopy(a.checkOut);
      const recordId = a.checkOut.recordId;
      items.push({
        id: kind,
        tone: "mint",
        icon: <LogOut />,
        eyebrow: "Attendance",
        title: copy.title,
        detail: copy.detail,
        actions: (
          <Button variant="ghost" className={PRIMARY} onClick={() => flow.checkOut(recordId)} disabled={flow.checkingOut}>
            <LogOut />
            {flow.checkingOut ? "Checking out…" : "Check out"}
          </Button>
        ),
      });
    }
  }
  return items;
}

/**
 * The cards for a dashboard where they apply (a staff view with the attendance feature on).
 * It owns the check-in flow, the attendance-pass kick and the teacher sheets, so a school
 * with attendance off makes none of those requests (spec §1: as fast as today).
 */
function ActiveTopSlot({ actions }: { actions: MyDashboardActions }) {
  // Owned here, not by a card: a check-in removes its card, and the teacher's follow-up
  // sheet must survive that.
  const flow = useStaffCheckFlow();
  // spread: every admin and coordinator dashboard of the school turns due at the same cutoff;
  // quiet: a background kick never toasts (the cron is the safety net).
  useAttendancePassKick(flow.institutionId, actions.data?.passDue === true, { spread: true, quiet: true });
  const timeZone = useInstitutionTimezone();

  // While a check-in card is due, re-render once a minute so its line turns "late" at the
  // school's check-in time without a request: nothing in the server's answer changes then.
  const checkInDue = actions.data?.checkIn?.state === "due";
  const [, setMinuteTick] = useState(0);
  useEffect(() => {
    if (!checkInDue) return;
    const id = window.setInterval(() => setMinuteTick((t) => t + 1), 60_000);
    return () => window.clearInterval(id);
  }, [checkInDue]);

  let content: ReactNode;
  if (actions.isError) {
    // Checked BEFORE the data: TanStack keeps the last answer when a refetch fails, and the
    // persisted cache restores this morning's, so "has data" never means "is current".
    content = <ActionsErrorCard onRetry={actions.refetch} />;
  } else if (!actions.data) {
    content = <SkyBox />;
  } else {
    const items = buildItems(actions.data, flow, schoolClock(new Date(), timeZone).time);
    content = items.length > 0 ? <ActionCardDeck items={items} /> : <Banner />;
  }

  return (
    <>
      {content}
      <StaffCheckSheets flow={flow} />
    </>
  );
}

/**
 * The top of a staff dashboard (spec 2026-10-03). When something is waiting for this person
 * today (check in, a period without a substitute, leave to decide, check out), floating clay
 * cards take the banner's exact box, in that order; otherwise the Clay School banner shows.
 * The banner mounts only when no card is due, so its 3D engine is never downloaded on the
 * way to showing cards.
 *
 * `view` is THIS dashboard's view: teacher hub "teacher", coordinator dashboard
 * "coordinator", admin landing "admin" (§25: one hat at a time; the server can only narrow).
 */
export function DashboardTopSlot({ view }: { view: ViewRole }) {
  const actions = useMyDashboardActions(view);
  useDashboardActionsRefresh(actions);
  if (actions.gatePending) return <SkyBox />;
  if (!actions.enabled) return <Banner />;
  return <ActiveTopSlot actions={actions} />;
}
