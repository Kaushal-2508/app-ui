import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CalendarCheck,
  CalendarClock,
  CalendarPlus,
  CalendarX2,
  ChevronLeft,
  ChevronRight,
  BriefcaseMedical,
  Palmtree,
  Coffee,
  Users,
  UserPlus2,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, StatTile, StatTileGrid } from "@/components/shared/surfaces";
import { StaffCheckInCard } from "@/components/attendance/StaffCheckInCard";
import { MyAttendancePanel } from "@/components/attendance/MyAttendancePanel";
import { StaffAttendanceTab } from "@/components/attendance/StaffAttendanceTab";
import { StaffLeaveQueueTab } from "@/components/attendance/StaffLeaveQueueTab";
import { SubstitutionReviewPanel } from "@/components/attendance/SubstitutionReviewPanel";
import { ApplyStaffLeaveSheet } from "@/components/attendance/ApplyStaffLeaveSheet";
import { StaffLeaveList } from "@/components/attendance/StaffLeaveList";
import {
  useMyStaffLeaveRequests,
  useMyStaffLeaveBalance,
  useWithdrawStaffLeave,
  useStaffLeaveReviewAvailable,
  useMyStaffRole,
  REVIEWER_LABEL,
  STAFF_LEAVE_PAGE_SIZE,
} from "@/hooks/useStaffLeaveRequests";
import { useUserRole } from "@/hooks/useUserRole";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useEffectiveInstitutionId } from "@/contexts/InstitutionContext";
import { useAttendanceSettings, useEffectiveAttendanceSettings } from "@/hooks/useAttendance";
import { isPastCutoff } from "@/hooks/useStaffAttendance";
import { useAttendancePassKick } from "@/hooks/useAttendancePassKick";

type WorkdayTab = "attendance" | "leaves" | "staff-attendance" | "staff-leaves" | "substitutions";

const WORKDAY_TABS: readonly string[] = ["attendance", "leaves", "staff-attendance", "staff-leaves", "substitutions"];
const isWorkdayTab = (v: string | null): v is WorkdayTab => v !== null && WORKDAY_TABS.includes(v);

/**
 * Workday: the staff side of attendance, for teachers, coordinators and
 * school admins. The Attendance page is students only.
 *
 *   everyone     → check-in card · My Attendance · My Leaves
 *   coordinator  → + Staff Attendance (wing teachers) · Staff Leaves
 *                    (their queue) · Substitutions
 *   admin        → + Staff Attendance (teachers + coordinators) · Staff
 *                    Leaves · Substitutions
 *
 * Until 2026-09-26 all of this sat on the Attendance page mixed with class
 * attendance, and this route held leave alone ("My Leaves"). Decisions on a
 * leave request are made one rung up (coordinator, admin, another admin)
 * from the Staff Leaves tab here; teachers only apply. Until the
 * review_staff_leave RPC exists, school admins decide from that tab against
 * the existing admin policy, so every school has an approver and Apply
 * always shows; the coordinator rung starts with the RPC.
 *
 * Route: /staff/workday (renamed 2026-09-28; /staff/my-leaves redirects).
 */
export default function WorkdayPage() {
  const [searchParams] = useSearchParams();
  // ?tab= opens a tab directly: the dashboard's substitution and leave cards link to
  // ?tab=substitutions and ?tab=staff-leaves. A tab this person's view does not have falls
  // back to My Attendance through safeTab below, as a stale click always did.
  const [tab, setTab] = useState<WorkdayTab>(() => {
    const requested = searchParams.get("tab");
    return isWorkdayTab(requested) ? requested : "attendance";
  });
  const [page, setPage] = useState(0);
  const [applyOpen, setApplyOpen] = useState(false);

  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  // One hat at a time (§25): the staff tabs follow the view picked in the
  // app bar, so a teacher+coordinator in Teacher view sees only their own
  // day, and Coordinator view adds the wing's staff.
  const isAdmin = (roleInfo?.isSchoolAdmin ?? false) && (!hasDualRole || activeViewRole === "admin");
  const isCoordinator = hasDualRole ? activeViewRole === "coordinator" : (roleInfo?.isCoordinator ?? false);
  const reviewsStaff = isAdmin || isCoordinator;

  const institutionId = useEffectiveInstitutionId(roleInfo?.institutionId ?? null);
  const myRole = useMyStaffRole();
  // Who reviews: the ladder once the RPC exists; the school admin while it
  // is missing (coordinators cannot see requests yet). Probed lazily, only
  // when the label is about to be shown, so a cold start costs no RPC.
  const probe = useStaffLeaveReviewAvailable(tab === "leaves" || applyOpen);
  const rpcMissing = probe.data === false || probe.isError;
  const reviewerLabel =
    probe.data === undefined && !probe.isError
      ? "Your reviewer"
      : rpcMissing && myRole !== "admin"
        ? "Your school admin"
        : myRole
          ? REVIEWER_LABEL[myRole]
          : "Your reviewer";

  // Materialize today's auto-absent staff rows + pending substitutions the moment an
  // admin/coordinator opens the staff side past local cutoff, instead of waiting up to 15 min
  // for the cron. Same once-a-day sessionStorage flag as the dashboards (useAttendancePassKick),
  // so it waits for the school's REAL settings row: the effective settings are the 08:00
  // defaults while loading and for a school with no row (where the pass does nothing), and
  // spending the shared flag then would skip the dashboard's kick for the rest of the day.
  const settingsQuery = useAttendanceSettings(institutionId);
  const effectiveSettings = useEffectiveAttendanceSettings(institutionId);
  useAttendancePassKick(
    institutionId,
    reviewsStaff && settingsQuery.isSuccess && !!settingsQuery.data && !!effectiveSettings && isPastCutoff(effectiveSettings),
  );

  const list = useMyStaffLeaveRequests(page);
  const balance = useMyStaffLeaveBalance();
  const withdraw = useWithdrawStaffLeave();

  const rows = list.data ?? [];
  // range()-bounded query: a full page is the only "there may be more" signal
  // without an extra count round-trip. Deliberate (§23).
  const hasNext = rows.length === STAFF_LEAVE_PAGE_SIZE;
  const hasPrev = page > 0;

  const tabOptions = useMemo<MobileTabOption[]>(() => {
    const own: MobileTabOption[] = [
      { value: "attendance", label: "My Attendance", icon: <CalendarClock className="h-3.5 w-3.5" /> },
      { value: "leaves", label: "My Leaves", icon: <CalendarPlus className="h-3.5 w-3.5" /> },
    ];
    if (!reviewsStaff) return own;
    // Staff Attendance holds Teachers / Coordinators as segmented sub-tabs;
    // the Coordinators list stays admin-only inside StaffAttendanceTab.
    // Staff Leaves is the reviewer's queue: coordinators decide their wing's
    // teachers, admins decide coordinators and other admins.
    return [
      ...own,
      { value: "staff-attendance", label: "Staff Attendance", icon: <Users className="h-3.5 w-3.5" /> },
      { value: "staff-leaves", label: "Staff Leaves", icon: <CalendarPlus className="h-3.5 w-3.5" /> },
      { value: "substitutions", label: "Substitutions", icon: <UserPlus2 className="h-3.5 w-3.5" /> },
    ];
  }, [reviewsStaff]);
  // Role info can arrive after a click landed on a staff tab; fall back.
  const safeTab: WorkdayTab = tabOptions.some((t) => t.value === tab) ? tab : "attendance";

  const subtitle = reviewsStaff
    ? isCoordinator && !isAdmin
      ? "Your check-in and leave, plus your wing's staff attendance."
      : "Your check-in and leave, plus staff attendance across the school."
    : "Your check-in, attendance history, and leave.";

  return (
    <PageShell>
      <PageHeader
        icon={<CalendarCheck className="h-5 w-5" />}
        title="Workday"
        subtitle={subtitle}
        primaryAction={{
          label: "Apply for leave",
          icon: <CalendarPlus className="h-4 w-4" />,
          onClick: () => setApplyOpen(true),
          disabled: !institutionId,
        }}
      />

      <div className="mb-4">
        <StaffCheckInCard />
      </div>

      <div className="mt-2">
        <MobileTabs value={safeTab} onValueChange={(v) => setTab(v as WorkdayTab)} options={tabOptions} />
      </div>

      <div className="mt-4">
        {safeTab === "attendance" ? (
          <MyAttendancePanel kind="staff" />
        ) : safeTab === "staff-attendance" ? (
          <StaffAttendanceTab />
        ) : safeTab === "staff-leaves" ? (
          <StaffLeaveQueueTab />
        ) : safeTab === "substitutions" ? (
          <SubstitutionReviewPanel />
        ) : (
          <div className="space-y-4">
            {/* Balances only when the school keeps them (HR sets them up); a
                school without balances just gets the list. */}
            {balance.data && (
              <StatTileGrid cols={3} mdCols={3}>
                <StatTile
                  label="Casual left"
                  value={Math.max(0, balance.data.casual_total - balance.data.casual_used)}
                  icon={<Coffee className="h-5 w-5" />}
                  tone="teal"
                  className="p-4 sm:p-5"
                />
                <StatTile
                  label="Sick left"
                  value={Math.max(0, balance.data.sick_total - balance.data.sick_used)}
                  icon={<BriefcaseMedical className="h-5 w-5" />}
                  tone="rose"
                  className="p-4 sm:p-5"
                />
                <StatTile
                  label="Annual left"
                  value={Math.max(0, balance.data.annual_total - balance.data.annual_used)}
                  icon={<Palmtree className="h-5 w-5" />}
                  tone="mint"
                  className="p-4 sm:p-5"
                />
              </StatTileGrid>
            )}

            <p className="text-xs text-ink-500">{reviewerLabel} reviews your requests.</p>

            {list.isLoading ? (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-24 rounded-card" />
                ))}
              </div>
            ) : list.isError ? (
              /* Error BEFORE empty (§6): a failed read must never read as "no requests". */
              <EmptyState
                icon={<CalendarX2 className="h-5 w-5" />}
                tone="rose"
                title="Couldn't load your leave requests"
                description="Please try again in a moment."
              />
            ) : (
              <>
                <StaffLeaveList
                  rows={rows}
                  variant="mine"
                  onWithdraw={(id) => withdraw.mutate(id)}
                  busyId={withdraw.isPending ? withdraw.variables ?? null : null}
                  emptyLabel={page > 0 ? "Nothing on this page" : "No leave requests yet"}
                  emptyDescription={page > 0 ? undefined : "Tap Apply for leave to send your first request."}
                />

                {(hasPrev || hasNext) && (
                  <div className="flex items-center justify-between gap-3">
                    <Button variant="outline" size="sm" className="rounded-full" disabled={!hasPrev} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                      <ChevronLeft className="h-4 w-4 mr-1" /> Newer
                    </Button>
                    <span className="text-xs text-ink-500">Page {page + 1}</span>
                    <Button variant="outline" size="sm" className="rounded-full" disabled={!hasNext} onClick={() => setPage((p) => p + 1)}>
                      Older <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <ApplyStaffLeaveSheet
        open={applyOpen}
        onOpenChange={setApplyOpen}
        institutionId={institutionId}
        reviewerLabel={reviewerLabel}
        // A request sent from the attendance tab should be visible at once.
        onApplied={() => setTab("leaves")}
      />
    </PageShell>
  );
}
