import { useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Calendar, CalendarClock, CalendarPlus, History, Info } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { FilterRow } from "@/components/shared/nav";
import { EmptyState } from "@/components/shared/surfaces";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { PTMCard } from "./PTMCard";
import { PTMFormSheet } from "./PTMFormSheet";
import { PTMModeChooserSheet } from "./PTMModeChooserSheet";
import { ResidentialPTMSheet } from "./ResidentialPTMSheet";
import { BookSlotSheet } from "./BookSlotSheet";
import { FeedbackSheet } from "./FeedbackSheet";
import { PTMDetailView } from "./PTMDetailView";
import { useAuth } from "@/hooks/useAuth";
import { useNow } from "@/hooks/useNow";
import { useUserRole } from "@/hooks/useUserRole";
import { canOpenPTM, ptmEffectiveStatus, ptmStartsAt, type PTMMode } from "@/lib/ptm";
import {
  usePTMHat,
  usePTMManageableScope,
  usePTMMyBookings,
  usePTMOnlineMySessions,
  usePTMOpenForFeedback,
  usePTMSchedules,
  usePTMSchemaReady,
  type PTMFeedbackContext,
  type PTMMyBooking,
  type PTMOnlineMySession,
  type PTMSchedule,
} from "@/hooks/ptm";

interface Props {
  institutionId: string;
}

const CARD_GRID = "grid gap-4 md:grid-cols-2 xl:grid-cols-3";

type PastStatus = "all" | "completed" | "cancelled";
type PastKind = "all" | PTMMode;
type PastWhen = "any" | "7d" | "30d" | "90d" | "year";
const PAST_KIND_WORD: Record<PTMMode, string> = { in_person: "regular", online: "online" };
const PAST_WHEN_LABEL: Record<PastWhen, string> = {
  any: "Any time",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 3 months",
  year: "This year",
};
const PAST_WHEN_DAYS: Partial<Record<PastWhen, number>> = { "7d": 7, "30d": 30, "90d": 90 };

/** Whether a PTM's plain `YYYY-MM-DD` date falls inside the chosen period,
 *  counted back from today in local time (display only). */
function withinPast(scheduledDate: string, when: PastWhen, now: Date): boolean {
  if (when === "any") return true;
  const [y, m, d] = scheduledDate.split("-").map(Number);
  if (!y || !m || !d) return true;
  const day = new Date(y, m - 1, d);
  if (when === "year") return day.getFullYear() === now.getFullYear();
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (PAST_WHEN_DAYS[when] ?? 0));
  return day.getTime() >= from.getTime();
}

function SectionHeading({ icon, tone, title }: { icon: ReactNode; tone: Tone; title: string }) {
  const t = TONES[tone];
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg", t.bg, t.fg)}
        aria-hidden="true"
      >
        {icon}
      </span>
      <h2 className="eyebrow">{title}</h2>
      <span
        className="h-px flex-1 bg-gradient-to-r from-surface-stroke to-transparent"
        aria-hidden="true"
      />
    </div>
  );
}

/** Placeholder cards in the shape of PTMCard, so the grid does not jump. */
function PTMCardSkeletons() {
  return (
    <div className={CARD_GRID} aria-busy="true">
      <span className="sr-only">Loading PTMs</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
          <div className="flex gap-3 sm:gap-4">
            <Skeleton className="h-20 w-14 shrink-0 rounded-2xl" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-3/4" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <Skeleton className="h-7 w-2/3" />
            <Skeleton className="h-7 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The PTM tab of the Communication page. Staff see every PTM of the school,
 * schedule new ones within their hat's scope, and open one to see its
 * bookings, feedback and QR (`?ptm=<id>`). Students see the PTMs for their
 * class, book a slot and give feedback from the card.
 *
 * Until Tushar's migration lands the schema probe is false: the list still
 * renders (legacy columns) and every write stays hidden.
 */
export function PTMPanel({ institutionId }: Props) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: roleInfo } = useUserRole();
  const { hat } = usePTMHat();
  const isStudent = !hat && Boolean(roleInfo?.isStudent);

  const probe = usePTMSchemaReady();
  const ready = probe.ready;
  const onlineReady = probe.onlineReady;
  const schedules = usePTMSchedules(institutionId, probe.level, !probe.isLoading);
  const scope = usePTMManageableScope(hat, ready);

  const myBookings = usePTMMyBookings(ready && isStudent);
  // Only to label the card "Edit feedback" once a row exists. While it loads
  // or if it fails the card falls back to "Give feedback"; the sheet resolves
  // the real row itself and the form then says "Update feedback".
  const openFeedback = usePTMOpenForFeedback(ready && isStudent);
  // Online PTMs: which teacher picked this student, and their booking.
  const mySessions = usePTMOnlineMySessions(onlineReady && isStudent);
  const now = useNow();

  // One row per teacher the student is with (several since 2026-10-09).
  const mySessionsByPtm = useMemo(() => {
    const map = new Map<string, PTMOnlineMySession[]>();
    for (const s of mySessions.data ?? []) map.set(s.ptm_id, [...(map.get(s.ptm_id) ?? []), s]);
    return map;
  }, [mySessions.data]);

  // A student sees an online PTM only when a teacher picked them for it. The
  // server's row policy already hides the rest; this is the same rule on the
  // client, applied only once the sessions have loaded so a failed call never
  // blanks the list.
  const ptms = useMemo(() => {
    const rows = schedules.data ?? [];
    if (!isStudent || !mySessions.isSuccess) return rows;
    return rows.filter((p) => p.mode !== "online" || mySessionsByPtm.has(p.id));
  }, [schedules.data, isStudent, mySessions.isSuccess, mySessionsByPtm]);

  const [searchParams, setSearchParams] = useSearchParams();
  const openId = searchParams.get("ptm");
  // True when this tab pushed the detail entry itself, so "All PTMs" can step
  // back through history (the phone's back button agrees) instead of piling
  // a second list entry on top.
  const pushedDetail = useRef(false);

  // Which create sheet is up. Once the online migration is live the button
  // asks first (chooser); before that it opens the regular form, as always.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [createMode, setCreateMode] = useState<PTMMode | null>(null);
  const [bookingPtm, setBookingPtm] = useState<PTMSchedule | null>(null);
  const [feedbackPtm, setFeedbackPtm] = useState<PTMSchedule | null>(null);

  const startScheduling = () => {
    if (onlineReady) setChooserOpen(true);
    else setCreateMode("in_person");
  };

  const openDetail = (id: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("ptm", id);
    pushedDetail.current = true;
    setSearchParams(next);
  };
  const closeDetail = () => {
    if (pushedDetail.current) {
      pushedDetail.current = false;
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.delete("ptm");
    setSearchParams(next, { replace: true });
  };

  // In person: at most one booking per PTM. Online: one per teacher.
  const myBookingsByPtm = useMemo(() => {
    const map = new Map<string, PTMMyBooking[]>();
    for (const b of myBookings.data ?? []) map.set(b.ptm_id, [...(map.get(b.ptm_id) ?? []), b]);
    return map;
  }, [myBookings.data]);

  const feedbackByPtm = useMemo(() => {
    const map = new Map<string, PTMFeedbackContext>();
    for (const c of openFeedback.data ?? []) map.set(c.ptm_id, c);
    return map;
  }, [openFeedback.data]);

  const { upcoming, past } = useMemo(() => {
    const now = new Date();
    const up: PTMSchedule[] = [];
    const old: PTMSchedule[] = [];
    for (const p of ptms) {
      const status = ptmEffectiveStatus(p, now);
      (status === "scheduled" || status === "active" ? up : old).push(p);
    }
    // Soonest first for what is coming; the query's newest-first order for
    // the rest. Sorting a bounded page for display, not aggregating.
    up.sort((a, b) => ptmStartsAt(a).getTime() - ptmStartsAt(b).getTime());
    return { upcoming: up, past: old };
  }, [ptms]);

  // Past and cancelled: a status and a kind filter over the cards (Naman,
  // 2026-10-09: "i need a filter for past and cancelled ptms"). Applied to
  // the bounded page already fetched for display, never a second query.
  const [pastStatus, setPastStatus] = useState<PastStatus>("all");
  const [pastKind, setPastKind] = useState<PastKind>("all");
  const [pastWhen, setPastWhen] = useState<PastWhen>("any");
  const pastShown = useMemo(() => {
    const today = new Date();
    return past.filter(
      (p) =>
        (pastStatus === "all" || (pastStatus === "cancelled") === (p.status === "cancelled")) &&
        (pastKind === "all" || p.mode === pastKind) &&
        withinPast(p.scheduled_date, pastWhen, today),
    );
  }, [past, pastStatus, pastKind, pastWhen]);
  const pastFilters = (pastStatus === "all" ? 0 : 1) + (pastKind === "all" ? 0 : 1) + (pastWhen === "any" ? 0 : 1);
  const clearPastFilters = () => {
    setPastStatus("all");
    setPastKind("all");
    setPastWhen("any");
  };
  const pastNothing = `There is no ${[pastStatus === "all" ? "past" : pastStatus, pastKind === "all" ? null : PAST_KIND_WORD[pastKind]]
    .filter(Boolean)
    .join(" ")} PTM ${pastWhen === "any" ? "in this list" : pastWhen === "year" ? "this year" : `in the ${PAST_WHEN_LABEL[pastWhen].toLowerCase()}`}.`;

  const scopeData = scope.data;
  const canSchedule =
    ready &&
    !!hat &&
    !!scopeData &&
    (scopeData.can_school || scopeData.wings.length > 0 || scopeData.classes.length > 0);
  // Say why the Schedule button is missing instead of dropping it silently;
  // a failed scope call is an error, never "nothing to schedule" (CLAUDE.md 6).
  const scopeFailed = ready && !!hat && scope.isError;
  const nothingToSchedule = ready && !!hat && !!scopeData && !canSchedule;

  if (openId && hat && ready) {
    return (
      <PTMDetailView
        ptmId={openId}
        institutionId={institutionId}
        hat={hat}
        level={probe.level}
        scope={scopeData}
        scopeLoading={scope.isLoading}
        scopeError={scope.isError}
        onBack={closeDetail}
      />
    );
  }

  const renderCards = (rows: PTMSchedule[]) => (
    <div className={CARD_GRID}>
      {rows.map((ptm) =>
        isStudent ? (
          <PTMCard
            key={ptm.id}
            ptm={ptm}
            audience="student"
            ready={ready}
            myBookings={myBookingsByPtm.get(ptm.id)}
            myFeedback={feedbackByPtm.get(ptm.id)?.my_feedback ?? null}
            feedbackClosesAt={feedbackByPtm.get(ptm.id)?.closes_at ?? null}
            mySessions={mySessionsByPtm.get(ptm.id)}
            mySessionError={isStudent && ptm.mode === "online" && mySessions.isError}
            onRetryMySession={() => void mySessions.refetch()}
            now={now}
            // Students have no detail page: a notification's ?ptm= lands on
            // the list with that card ringed.
            highlight={openId === ptm.id}
            onBook={() => setBookingPtm(ptm)}
            onFeedback={() => setFeedbackPtm(ptm)}
          />
        ) : (
          <PTMCard
            key={ptm.id}
            ptm={ptm}
            audience="staff"
            ready={ready}
            onOpen={
              ready &&
              canOpenPTM(
                ptm.classes,
                scopeData?.classes ?? [],
                hat,
                !!user && ptm.online_teacher_ids.includes(user.id),
              )
                ? () => openDetail(ptm.id)
                : undefined
            }
          />
        ),
      )}
    </div>
  );

  return (
    <div className="space-y-5">
      {hat && !ready && !probe.isLoading && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-ink-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <p>
            Scheduling, slot booking and feedback switch on once this school's PTM setup is
            finished. Meetings already scheduled are listed below.
          </p>
        </div>
      )}

      {scopeFailed && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-3 text-sm text-ink-700">
          <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden="true" />
          <p className="min-w-0 flex-1">Couldn't check which classes you can schedule a PTM for.</p>
          <Button variant="outline" size="sm" onClick={() => scope.refetch()}>
            Retry
          </Button>
        </div>
      )}

      {nothingToSchedule && (
        <div className="flex items-start gap-2 rounded-xl border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-ink-700">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
          <p>
            {hat === "coordinator"
              ? "You can schedule a PTM for the classes in your wings. No wing is assigned to you yet, so ask your school admin to add you to one."
              : "You can schedule a PTM for the classes you teach. No class is assigned to you yet, so ask your school admin to add you to one."}
          </p>
        </div>
      )}

      {canSchedule && (
        <div className="flex justify-end">
          <Button onClick={startScheduling}>
            <CalendarPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Schedule PTM
          </Button>
        </div>
      )}

      {probe.isLoading || schedules.isLoading ? (
        <PTMCardSkeletons />
      ) : schedules.isError ? (
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          reason="error"
          title="Couldn't load PTMs"
          description="Check your connection and try again."
          action={{ label: "Retry", onClick: () => schedules.refetch() }}
        />
      ) : ptms.length === 0 ? (
        <EmptyState
          icon={<Calendar className="h-7 w-7" />}
          reason="noData"
          title={isStudent ? "No PTM for your class yet" : "No PTM scheduled yet"}
          description={
            isStudent
              ? "When the school schedules a parent-teacher meeting for your class, it appears here."
              : "Scheduled meetings appear here, with their bookings and feedback."
          }
          action={canSchedule ? { label: "Schedule a PTM", onClick: startScheduling } : undefined}
        />
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                icon={<CalendarClock className="h-3.5 w-3.5" />}
                tone="teal"
                title="Upcoming"
              />
              {renderCards(upcoming)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <SectionHeading
                icon={<History className="h-3.5 w-3.5" />}
                tone="violet"
                title="Past and cancelled"
              />
              <FilterRow activeCount={pastFilters} onClear={clearPastFilters}>
                <Select value={pastStatus} onValueChange={(v) => setPastStatus(v as PastStatus)}>
                  <SelectTrigger
                    id="ptm-past-status"
                    aria-label="Status"
                    className="h-10 w-40 shrink-0 rounded-full bg-[hsl(var(--surface-card)/0.85)] focus:ring-inset focus:ring-offset-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
                {onlineReady && (
                  <Select value={pastKind} onValueChange={(v) => setPastKind(v as PastKind)}>
                    <SelectTrigger
                      id="ptm-past-kind"
                      aria-label="Kind"
                      className="h-10 w-36 shrink-0 rounded-full bg-[hsl(var(--surface-card)/0.85)] focus:ring-inset focus:ring-offset-0"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All kinds</SelectItem>
                      <SelectItem value="in_person">Regular</SelectItem>
                      <SelectItem value="online">Online</SelectItem>
                    </SelectContent>
                  </Select>
                )}
                <Select value={pastWhen} onValueChange={(v) => setPastWhen(v as PastWhen)}>
                  <SelectTrigger
                    id="ptm-past-when"
                    aria-label="When"
                    className="h-10 w-40 shrink-0 rounded-full bg-[hsl(var(--surface-card)/0.85)] focus:ring-inset focus:ring-offset-0"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PAST_WHEN_LABEL) as PastWhen[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {PAST_WHEN_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterRow>
              {pastShown.length === 0 ? (
                <EmptyState
                  size="sm"
                  icon={<History className="h-7 w-7" />}
                  reason="noData"
                  title="No PTM matches"
                  description={pastNothing}
                  action={{ label: "Clear filters", onClick: clearPastFilters }}
                />
              ) : (
                renderCards(pastShown)
              )}
            </section>
          )}
        </div>
      )}

      {hat && (
        <>
          <PTMModeChooserSheet
            open={chooserOpen}
            onOpenChange={setChooserOpen}
            hat={hat}
            onPick={(mode) => {
              setChooserOpen(false);
              setCreateMode(mode);
            }}
          />
          <PTMFormSheet
            open={createMode === "in_person"}
            onOpenChange={(open) => !open && setCreateMode(null)}
            institutionId={institutionId}
            hat={hat}
            onSaved={(id) => openDetail(id)}
          />
          {onlineReady && (
            <ResidentialPTMSheet
              open={createMode === "online"}
              onOpenChange={(open) => !open && setCreateMode(null)}
              institutionId={institutionId}
              hat={hat}
              onSaved={(id) => openDetail(id)}
            />
          )}
        </>
      )}
      {isStudent && (
        <>
          <BookSlotSheet
            ptm={bookingPtm}
            mySessions={bookingPtm ? mySessionsByPtm.get(bookingPtm.id) : undefined}
            onClose={() => setBookingPtm(null)}
          />
          <FeedbackSheet ptm={feedbackPtm} onClose={() => setFeedbackPtm(null)} />
        </>
      )}
    </div>
  );
}
