import { type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { AlertTriangle, CalendarOff, Check, Clock, LogIn, LogOut, Palmtree, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { StaffCheckSheets } from "@/components/attendance/StaffCheckSheets";
import type { ViewRole } from "@/contexts/ActiveRoleContext";
import { useMyDashboardActions } from "@/hooks/useMyDashboardActions";
import { useStaffCheckFlow } from "@/hooks/useStaffCheckFlow";
import {
  useTodayStaffAttendance,
  classifyStaffCheckIn,
  type StaffAttendanceStatus,
} from "@/hooks/useStaffAttendance";
import { formatClock, ownsCheckButton } from "@/lib/dashboardActions";
import { cn } from "@/lib/utils";

// Token colours only, so both themes flip through the variables (design system).
const STATUS_CHIP: Record<StaffAttendanceStatus, { label: string; tone: string }> = {
  present:  { label: "Present",  tone: "bg-brand-primary/10 text-brand-primary" },
  late:     { label: "Late",     tone: "bg-signal-warn/10 text-signal-warn" },
  absent:   { label: "Absent",   tone: "bg-destructive/10 text-destructive" },
  on_leave: { label: "On leave", tone: "bg-brand-secondary/15 text-ink-700" },
  holiday:  { label: "Holiday",  tone: "bg-ink-400/10 text-ink-600" },
};

function StatusChip({ status }: { status: StaffAttendanceStatus }) {
  const { label, tone } = STATUS_CHIP[status];
  return (
    <span className={cn("inline-flex items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wide", tone)}>
      {label}
    </span>
  );
}

export interface StaffCheckInCardProps {
  compact?: boolean;
  /**
   * The dashboard this compact button sits on. While that dashboard's action cards speak
   * for today's check-in or check-out (or say "Marked absent"), the button steps aside, so
   * there are never two of them (spec 2026-10-03). Leave it out anywhere else (Workday).
   */
  view?: ViewRole;
}

/**
 * Today's self-attendance for staff (teachers, coordinators, school admins). States:
 *
 *   - Loading, or a failed read (error before empty, §6: a failed read must never offer a
 *     Check in that may collide with a row it could not see).
 *   - Holiday, on leave, or marked absent (by the attendance pass or an admin): no action,
 *     because a self check-in would collide with the row (23505).
 *   - Not checked in yet: "Check in", previewing whether it will be recorded as late.
 *   - Checked in: "Check out", which is never blocked; teachers then get the dismissible
 *     syllabus sheet.
 *   - Checked out: both times, no actions.
 *
 * `compact` is the one small teal button in the dashboard greeting; the full card is on
 * Workday. Both share useStaffCheckFlow with the dashboard's action cards. Times read on the
 * 12-hour clock, like the cards.
 */
export function StaffCheckInCard({ compact = false, view }: StaffCheckInCardProps = {}) {
  const flow = useStaffCheckFlow();
  const todayQuery = useTodayStaffAttendance();
  const actions = useMyDashboardActions(compact && view ? view : null);

  if (!flow.institutionId) return null;

  const today = todayQuery.data ?? null;
  const loading = todayQuery.isLoading || flow.settingsLoading;
  const todayLabel = format(new Date(), "EEEE, d MMM");
  const checkInTimeLabel = formatClock(flow.settings ? flow.settings.staff_check_in_time : "08:00");
  const checkOutTimeLabel = formatClock(flow.settings ? flow.settings.staff_check_out_time : "16:00");
  // Absent with no check-in, whether the attendance pass or an admin wrote it.
  const markedAbsent = today?.status === "absent" && !today.check_in_at;
  const retry = () => {
    void todayQuery.refetch();
  };

  const pill = (label: string, icon: ReactNode, tone: "teal" | "rose" = "teal") => (
    <span
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-full px-3 text-sm font-medium",
        tone === "rose" ? "bg-destructive/10 text-destructive" : "bg-brand-primary/10 text-brand-primary",
      )}
    >
      {icon}
      {label}
    </span>
  );

  // Compact: ONE small teal button for the dashboard header (asked 2026-09-26: "just a small
  // button, not a bar, teal"). Once the day is closed it becomes a small inert pill. Icons
  // inside a Button need no size or margin: the Button sizes them and spaces them (gap-2).
  const renderCompact = (): ReactNode => {
    // While the cards show their error card they own nothing, so the button stays.
    if (view && !actions.isError && ownsCheckButton(actions.data)) return null;
    // Wait for the dashboard's answer too, so the button does not flash in and then step
    // aside a moment later when a check-in card arrives.
    const actionsPending = !!view && (actions.gatePending || (actions.enabled && !actions.data && !actions.isError));
    if (loading || actionsPending) return <Skeleton className="h-9 w-28 rounded-full" />;
    if (todayQuery.isError) {
      return (
        <Button
          size="sm"
          variant="outline"
          className="h-9 rounded-full px-3"
          aria-label="Couldn't load your check-in. Retry"
          onClick={retry}
        >
          <RotateCw />
          Retry
        </Button>
      );
    }
    if (today?.status === "holiday") return pill("Holiday", <CalendarOff className="h-4 w-4" />);
    if (today?.status === "on_leave") return pill("On leave", <Palmtree className="h-4 w-4" />);
    if (markedAbsent) return pill("Marked absent", <AlertTriangle className="h-4 w-4" />, "rose");
    if (today?.check_in_at) {
      if (today.check_out_at) {
        return pill(`Checked out ${format(parseISO(today.check_out_at), "h:mm a")}`, <Check className="h-4 w-4" />);
      }
      const recordId = today.id;
      return (
        <Button
          size="sm"
          title={`Checked in at ${format(parseISO(today.check_in_at), "h:mm a")}`}
          onClick={() => flow.checkOut(recordId)}
          disabled={flow.checkingOut}
          /* Same fill as the teacher chip in the app-bar role switcher. */
          className="h-9 rounded-full bg-brand-primary px-4 text-white shadow-card-sm hover:bg-brand-primary/90"
        >
          <LogOut />
          {flow.checkingOut ? "Checking out…" : "Check out"}
        </Button>
      );
    }
    const preview = flow.settings ? classifyStaffCheckIn(new Date(), flow.settings) : "present";
    return (
      <Button
        size="sm"
        title={preview === "present" ? `Check in by ${checkInTimeLabel}` : `Past ${checkInTimeLabel}: will be recorded as late`}
        onClick={flow.checkIn}
        disabled={flow.checkingIn}
        className="h-9 rounded-full bg-brand-primary px-4 text-white shadow-card-sm hover:bg-brand-primary/90"
      >
        <LogIn />
        {flow.checkingIn ? "Checking in…" : "Check in"}
      </Button>
    );
  };

  const notice = (icon: ReactNode, iconTone: string, title: string, body: string, chip: ReactNode) => (
    <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
      <p className="eyebrow">Today · {todayLabel}</p>
      <div className="mt-2 flex items-start gap-3">
        <span className={cn("inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", iconTone)}>{icon}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-ink-900">{title}</h3>
          <p className="mt-1 text-sm text-ink-600">{body}</p>
        </div>
        {chip}
      </div>
    </div>
  );

  const renderFull = (): ReactNode => {
    if (loading) {
      return (
        <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
          <Skeleton className="mb-3 h-4 w-24" />
          <Skeleton className="mb-2 h-7 w-48" />
          <Skeleton className="mt-4 h-10 w-32" />
        </div>
      );
    }
    if (todayQuery.isError) {
      return notice(
        <AlertTriangle className="h-5 w-5" />,
        "bg-destructive/10 text-destructive",
        "Couldn't load your check-in",
        "Check your connection and try again.",
        <Button variant="outline" size="sm" className="rounded-xl" onClick={retry}>
          <RotateCw />
          Retry
        </Button>,
      );
    }
    if (today?.status === "holiday") {
      return notice(<CalendarOff className="h-5 w-5" />, "bg-brand-primary/10 text-brand-primary",
        "Holiday", "No check-in needed today.", <StatusChip status="holiday" />);
    }
    if (today?.status === "on_leave") {
      return notice(<Palmtree className="h-5 w-5" />, "bg-brand-primary/10 text-brand-primary",
        "On leave today", "No check-in needed today.", <StatusChip status="on_leave" />);
    }
    if (today && markedAbsent) {
      return notice(<AlertTriangle className="h-5 w-5" />, "bg-destructive/10 text-destructive",
        "Marked absent",
        today.auto_marked_absent
          ? `You didn't check in by ${checkInTimeLabel}. Contact your admin if this is wrong.`
          : "Your admin marked you absent today. Contact them if this is wrong.",
        <StatusChip status="absent" />);
    }

    if (today?.check_in_at) {
      const checkedInAt = format(parseISO(today.check_in_at), "h:mm a");
      const checkedOutAt = today.check_out_at ? format(parseISO(today.check_out_at), "h:mm a") : null;
      const recordId = today.id;
      // Records written before the manual check-in cap may say "absent" although the person
      // checked in; show them as late (display only).
      const displayedStatus: StaffAttendanceStatus =
        today.status === "absent" && !today.auto_marked_absent ? "late" : today.status;
      return (
        <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="eyebrow">Today · {todayLabel}</p>
              <h3 className="mt-1 text-lg font-semibold text-ink-900 sm:text-xl">Checked in at {checkedInAt}</h3>
              {checkedOutAt && <p className="mt-1 text-sm text-ink-600">Checked out at {checkedOutAt}</p>}
            </div>
            <StatusChip status={displayedStatus} />
          </div>
          {!checkedOutAt && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => flow.checkOut(recordId)} disabled={flow.checkingOut} variant="outline" className="rounded-xl">
                <LogOut />
                {flow.checkingOut ? "Checking out…" : "Check Out"}
              </Button>
              <span className="inline-flex items-center text-xs text-ink-500">
                <Clock className="mr-1 h-3.5 w-3.5" />
                Window closes at {checkOutTimeLabel}
              </span>
            </div>
          )}
        </div>
      );
    }

    // Not checked in yet: preview what tapping now would record (manual check-ins are
    // capped at "late", see useStaffAttendance.ts).
    const previewStatus = flow.settings ? classifyStaffCheckIn(new Date(), flow.settings) : "present";
    const displayStatus: StaffAttendanceStatus = previewStatus === "absent" ? "late" : previewStatus;
    const previewLabel =
      previewStatus === "present"
        ? `On time · check-in by ${checkInTimeLabel}`
        : previewStatus === "absent"
          ? "Very late · past grace period, but check-in will be recorded as late"
          : `Late · within grace period (cut-off was ${checkInTimeLabel})`;
    return (
      <div className="surface-card frosted-shadow rounded-card p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="eyebrow">Today · {todayLabel}</p>
            <h3 className="mt-1 text-lg font-semibold text-ink-900 sm:text-xl">Mark your attendance</h3>
            <p className="mt-1 text-sm text-ink-600">{previewLabel}</p>
          </div>
          {displayStatus !== "present" && <StatusChip status={displayStatus} />}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button onClick={flow.checkIn} disabled={flow.checkingIn} className="rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90">
            {flow.checkingIn ? <Check /> : <LogIn />}
            {flow.checkingIn ? "Checking in…" : "Check In"}
          </Button>
          <span className="inline-flex items-center text-xs text-ink-500">
            <Clock className="mr-1 h-3.5 w-3.5" />
            Window: {checkInTimeLabel} to {checkOutTimeLabel}
          </span>
        </div>
      </div>
    );
  };

  return (
    <>
      {compact ? renderCompact() : renderFull()}
      {/* One element at one position in every branch: a check-in flips the branch above,
          and the open backlog sheet must not be unmounted by it (that wiped its picker
          state and flickered the sheet). */}
      <StaffCheckSheets flow={flow} />
    </>
  );
}
