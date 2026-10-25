import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  CalendarOff,
  CalendarX,
  Loader2,
  MapPin,
  MessageSquare,
  MessageSquareHeart,
  Pencil,
  SearchX,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileTabs } from "@/components/shared/nav";
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { StudentRemarksPanel } from "@/components/communication/StudentRemarksPanel";
import { PTMStatusBadge } from "./PTMStatusBadge";
import { PTMModeBadge } from "./PTMModeBadge";
import { PTMScopeChips } from "./PTMScopeChips";
import { PTMQRCard } from "./PTMQRCard";
import { PTMFormSheet } from "./PTMFormSheet";
import { ResidentialPTMSheet } from "./ResidentialPTMSheet";
import { PTMCancelDialog } from "./PTMCancelDialog";
import { SlotGrid } from "./SlotGrid";
import { FeedbackDashboard } from "./FeedbackDashboard";
import { PTMFeedbackTree } from "./PTMFeedbackTree";
import { Fact } from "./Fact";
import { GoogleEmailSheet } from "./GoogleEmailSheet";
import { OnlineBookingsTab, OnlineOverviewTab } from "./OnlineDetailTabs";
import { ClassSessionsSheet } from "./ClassSessionsSheet";
import { ChangeTeachersSheet, SwapTeacherSheet } from "./OnlineTeacherSheets";
import { useAuth } from "@/hooks/useAuth";
import { useNow } from "@/hooks/useNow";
import { formatClassName } from "@/lib/utils";
import {
  canEditOwnSession,
  canManagePTM,
  describeCutoff,
  describeEditWindow,
  formatPTMDate,
  formatTimeRange,
  ptmEffectiveStatus,
  ptmViewableClasses,
  sentenceCase,
  type PTMClassLike,
  type PTMHat,
} from "@/lib/ptm";
import {
  usePTMBookingGrid,
  usePTMOnlineSessions,
  usePTMSchedule,
  useSetPTMBookingAttended,
  type PTMManageableScope,
  type PTMOnlineSession,
  type PTMSchedule,
  type PTMSchemaLevel,
} from "@/hooks/ptm";

interface Props {
  ptmId: string;
  institutionId: string;
  hat: PTMHat;
  /** Which PTM columns are live; decides the select (see usePTMSchemaReady). */
  level: PTMSchemaLevel;
  scope: PTMManageableScope | undefined;
  scopeLoading: boolean;
  scopeError: boolean;
  onBack: () => void;
}

type DetailTab = "overview" | "bookings" | "feedback";

/**
 * One PTM for staff: details and the QR, the per-class slot grids, and the
 * feedback dashboard. Lives inside the Communication page at
 * `?tab=ptm&ptm=<id>` (the Notice Board's `?notice=` pattern), so it needs no
 * route of its own. Everything shown is scoped to the hat by the server.
 */
export function PTMDetailView({
  ptmId,
  institutionId,
  hat,
  level,
  scope,
  scopeLoading,
  scopeError,
  onBack,
}: Props) {
  const { user } = useAuth();
  const query = usePTMSchedule(ptmId, level);
  const [tab, setTab] = useState<DetailTab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  // A teacher's own student list has its own sheet and button (Naman,
  // 2026-10-09: "for selecting students give a separate button instead of
  // edit"); Edit is the PTM itself, for whoever manages it.
  const [studentsOpen, setStudentsOpen] = useState(false);
  const [cancelling, setCancelling] = useState<PTMSchedule | null>(null);
  // Online PTMs only: the Google-account sheet, the admin's teacher list
  // (flat, or per class at probe level `sessions`) and the swap sheet.
  const [googleFor, setGoogleFor] = useState<{ id: string; name: string; self: boolean } | null>(null);
  const [teachersOpen, setTeachersOpen] = useState(false);
  const [classSessionsOpen, setClassSessionsOpen] = useState(false);
  const [swapFrom, setSwapFrom] = useState<PTMOnlineSession | null>(null);

  const ptm = query.data ?? null;
  const online = ptm?.mode === "online";
  const sessions = usePTMOnlineSessions(ptmId, online);
  const now = useNow();
  const mySession = (sessions.data ?? []).find((s) => s.is_me) ?? null;

  const viewable = useMemo<PTMClassLike[]>(
    () => (ptm ? ptmViewableClasses(ptm.classes, scope?.classes ?? [], hat) : []),
    [ptm, scope, hat],
  );

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center py-16" aria-busy="true">
        <Loader2 className="h-8 w-8 animate-spin text-ink-500" aria-label="Loading" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          reason="error"
          title="Couldn't load this PTM"
          description="Check your connection and try again."
          action={{ label: "Retry", onClick: () => query.refetch() }}
        />
      </div>
    );
  }

  if (!ptm) {
    return (
      <div className="space-y-4">
        <BackButton onBack={onBack} />
        <EmptyState
          icon={<SearchX className="h-7 w-7" />}
          reason="noData"
          title="This PTM isn't available"
          description="It may have been removed, or it belongs to another school."
        />
      </div>
    );
  }

  const status = ptmEffectiveStatus(ptm);
  const manage = canManagePTM(
    {
      scope_type: ptm.scope_type,
      classIds: ptm.classes.map((c) => c.id),
      status: ptm.status,
      created_by: ptm.created_by,
      created_as_role: ptm.created_as_role,
      mode: ptm.mode,
    },
    {
      userId: user?.id ?? null,
      hat,
      scope: scope ? { can_school: scope.can_school, classIds: new Set(scope.classes.map((c) => c.id)) } : null,
    },
  );

  // A participating teacher edits their own student list from Edit too,
  // even when an admin made the PTM (Naman, 2026-10-06).
  const mayEditOwn = online && !!mySession && canEditOwnSession(ptm, hat, true, now);

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <BackButton onBack={onBack} />
        <div className="min-w-0">
          {/* Title and badges on one line (Naman, 2026-10-06: on a wide screen
              the badges sat alone at the far right). */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-xl font-bold leading-tight text-ink-900 sm:text-2xl">{ptm.title}</h2>
            <span className="flex items-center gap-1.5">
              <PTMStatusBadge status={status} />
              <PTMModeBadge mode={ptm.mode} />
            </span>
          </div>
          <p className="mt-1 text-sm text-ink-600">
            {formatPTMDate(ptm.scheduled_date)}, {formatTimeRange(ptm.start_time, ptm.end_time)}
          </p>
        </div>
        {/* Tabs left, actions right, one row from sm up. */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MobileTabs
            value={tab}
            onValueChange={(v) => setTab(v as DetailTab)}
            options={[
              { value: "overview", label: "Overview" },
              { value: "bookings", label: "Bookings" },
              { value: "feedback", label: "Feedback" },
            ]}
            variant="segmented"
            density="compact"
          />
          {(manage || mayEditOwn) && (
            <div className="flex flex-wrap gap-2">
              {mayEditOwn && (
                <Button variant="outline" size="sm" onClick={() => setStudentsOpen(true)}>
                  <Users className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  {mySession && mySession.student_count > 0 ? "Students" : "Pick students"}
                </Button>
              )}
              {manage && (
                <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                  <Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Edit
                </Button>
              )}
              {/* A meeting that has already happened cannot be cancelled: the
                  notice would reach every family after the fact. */}
              {manage && status !== "completed" && (
                <Button variant="outline" size="sm" onClick={() => setCancelling(ptm)}>
                  <CalendarX className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Cancel PTM
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {tab === "overview" &&
        (online ? (
          <OnlineOverviewTab
            ptm={ptm}
            hat={hat}
            sessions={sessions}
            now={now}
            canManage={manage}
            onSetGoogleEmail={(id, name, self) => setGoogleFor({ id, name, self })}
            onChangeTeachers={() => setTeachersOpen(true)}
            onChangeClassSessions={() => setClassSessionsOpen(true)}
            onSwapTeacher={(s) => setSwapFrom(s)}
          />
        ) : (
          <OverviewTab ptm={ptm} />
        ))}

      {tab === "bookings" &&
        (online ? (
          <OnlineBookingsTab
            ptm={ptm}
            hat={hat}
            institutionId={institutionId}
            sessions={sessions}
            now={now}
            onPickStudents={() => setStudentsOpen(true)}
          />
        ) : (
          <BookingsTab
            ptm={ptm}
            hat={hat}
            institutionId={institutionId}
            viewable={viewable}
            scopeLoading={scopeLoading}
            scopeError={scopeError}
            canManage={manage}
            onTurnOn={() => setEditOpen(true)}
          />
        ))}

      {tab === "feedback" &&
        (scopeLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading" />
          </div>
        ) : scopeError ? (
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            tone="rose"
            reason="error"
            title="Couldn't check which classes you can see"
            description="Close this PTM and open it again."
          />
        ) : viewable.length === 0 ? (
          <NotYourClasses hat={hat} />
        ) : (
          <div className="space-y-6">
            <FeedbackDashboard ptmId={ptm.id} hat={hat} slotBookingEnabled={ptm.slot_booking_enabled} />
            {/* Wings, then classes, then each family's feedback: the same
                drill-down as the Command Center's School performance tree. */}
            <PTMFeedbackTree
              ptmId={ptm.id}
              ptmTitle={ptm.title}
              hat={hat}
              scope={scope}
              slotBookingEnabled={ptm.slot_booking_enabled}
            />
          </div>
        ))}

      {online ? (
        <>
          {manage && (
            <ResidentialPTMSheet open={editOpen} onOpenChange={setEditOpen} institutionId={institutionId} hat={hat} ptm={ptm} />
          )}
          {mayEditOwn && (
            <ResidentialPTMSheet
              open={studentsOpen}
              onOpenChange={setStudentsOpen}
              institutionId={institutionId}
              hat={hat}
              ptm={ptm}
              studentsOnly
            />
          )}
        </>
      ) : (
        <PTMFormSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          institutionId={institutionId}
          hat={hat}
          ptm={ptm}
        />
      )}
      {online && (
        <>
          <ClassSessionsSheet
            ptm={ptm}
            hat={hat}
            sessions={sessions.data ?? []}
            sessionsReady={sessions.isSuccess}
            open={classSessionsOpen}
            onOpenChange={setClassSessionsOpen}
            onSetGoogleEmail={hat === "admin" ? (id, name) => setGoogleFor({ id, name, self: false }) : undefined}
          />
          <ChangeTeachersSheet
            ptm={ptm}
            hat={hat}
            sessions={sessions.data ?? []}
            sessionsReady={sessions.isSuccess}
            open={teachersOpen}
            onOpenChange={setTeachersOpen}
            onSetGoogleEmail={hat === "admin" ? (id, name) => setGoogleFor({ id, name, self: false }) : undefined}
          />
          <SwapTeacherSheet ptm={ptm} hat={hat} from={swapFrom} sessions={sessions.data ?? []} onClose={() => setSwapFrom(null)} />
        </>
      )}
      {googleFor && (
        <GoogleEmailSheet
          open
          onOpenChange={(next) => !next && setGoogleFor(null)}
          userId={googleFor.id}
          displayName={googleFor.name}
          self={googleFor.self}
        />
      )}
      <PTMCancelDialog ptm={cancelling} onClose={() => setCancelling(null)} />
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2">
      <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
      All PTMs
    </Button>
  );
}

function NotYourClasses({ hat }: { hat: PTMHat }) {
  return (
    <EmptyState
      icon={<Users className="h-7 w-7" />}
      reason="noData"
      title="None of your classes are in this PTM"
      description={
        hat === "teacher"
          ? "You see bookings and feedback for the classes you teach."
          : "You see bookings and feedback for the classes in your wing."
      }
    />
  );
}

// Fact and sentenceCase live in ./Fact since 2026-10-03, shared with the
// online overview.

function OverviewTab({ ptm }: { ptm: PTMSchedule }) {
  const showQr = !!ptm.feedback_token && ptm.status !== "cancelled";

  return (
    <div className="space-y-4">
      <section className="surface-card frosted-shadow rounded-card p-4 sm:p-5">
        <h3 className="text-base font-semibold text-ink-900">Details</h3>
        {ptm.description && (
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-700">{ptm.description}</p>
        )}
        <dl className="mt-4 grid gap-3 sm:grid-cols-2">
          <Fact icon={<MapPin />} tone="peach" label="Venue">
            {ptm.venue || <span className="font-normal text-ink-400">Not set</span>}
          </Fact>
          <Fact icon={<Users />} tone="sky" label="For">
            <PTMScopeChips
              scopeType={ptm.scope_type}
              wingName={ptm.scope_wing_name}
              classes={ptm.classes}
              max={8}
            />
          </Fact>
          <Fact
            icon={<CalendarCheck />}
            tone="mint"
            label="Slot booking"
            note={
              ptm.slot_booking_enabled
                ? `Families can book or change ${describeCutoff(ptm.booking_cutoff_minutes)}.`
                : "Families see the time and venue only."
            }
          >
            {ptm.slot_booking_enabled ? `On · ${ptm.slot_duration_minutes}-minute slots` : "Off"}
          </Fact>
          <Fact
            icon={<MessageSquareHeart />}
            tone="violet"
            label="Feedback"
            note="Opens when the meeting starts."
          >
            {sentenceCase(describeEditWindow(ptm.feedback_edit_days))}
          </Fact>
        </dl>
      </section>

      {/* No class-teacher list: there is no class teacher role, a teacher
          acts for the classes they teach (Naman, 2026-09-29). */}
      {showQr && ptm.feedback_token && (
        <PTMQRCard
          token={ptm.feedback_token}
          title={ptm.title}
          subtitle={`${formatPTMDate(ptm.scheduled_date)}${ptm.venue ? `, ${ptm.venue}` : ""}`}
        />
      )}
    </div>
  );
}

function BookingsTab({
  ptm,
  hat,
  institutionId,
  viewable,
  scopeLoading,
  scopeError,
  canManage,
  onTurnOn,
}: {
  ptm: PTMSchedule;
  hat: PTMHat;
  institutionId: string;
  viewable: PTMClassLike[];
  scopeLoading: boolean;
  scopeError: boolean;
  canManage: boolean;
  onTurnOn: () => void;
}) {
  const [classId, setClassId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [remarksFor, setRemarksFor] = useState<{ id: string; name: string } | null>(null);
  const setAttended = useSetPTMBookingAttended();

  // Keep the picked class valid when the hat (and so the list) changes.
  useEffect(() => {
    if (viewable.length === 0) {
      setClassId(null);
    } else if (!classId || !viewable.some((c) => c.id === classId)) {
      setClassId(viewable[0].id);
    }
  }, [viewable, classId]);

  const grid = usePTMBookingGrid(ptm.id, classId, ptm.slot_booking_enabled && !!classId);

  if (!ptm.slot_booking_enabled) {
    return (
      <EmptyState
        icon={<CalendarOff className="h-7 w-7" />}
        reason="noData"
        title="Slot booking is off"
        description="Families see the time and venue only. Turn slot booking on to give each class its own grid."
        action={canManage && ptm.status !== "cancelled" ? { label: "Turn on slot booking", onClick: onTurnOn } : undefined}
      />
    );
  }
  if (scopeLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading" />
      </div>
    );
  }
  if (scopeError) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        tone="rose"
        reason="error"
        title="Couldn't check which classes you can see"
        description="Close this PTM and open it again."
      />
    );
  }
  if (viewable.length === 0) return <NotYourClasses hat={hat} />;

  const booked = (grid.data ?? []).filter((s) => !!s.booking_id).length;
  const total = (grid.data ?? []).filter((s) => !s.off_grid).length;

  return (
    <section className="surface-card frosted-shadow rounded-card space-y-4 p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        {viewable.length > 1 ? (
          <div className="w-full space-y-2 sm:w-64">
            <Label htmlFor="ptm-bookings-class">Class</Label>
            <Select value={classId ?? ""} onValueChange={setClassId}>
              <SelectTrigger id="ptm-bookings-class">
                <SelectValue placeholder="Choose a class" />
              </SelectTrigger>
              <SelectContent>
                {viewable.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {formatClassName(c.name, c.section)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <h3 className="text-base font-semibold text-ink-900">
            {formatClassName(viewable[0].name, viewable[0].section)}
          </h3>
        )}
        {grid.data && (
          <p className="text-sm text-ink-600">
            {booked} of {total} slots booked
          </p>
        )}
      </div>

      {grid.isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading slots" />
        </div>
      ) : grid.isError ? (
        <EmptyState
          size="sm"
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          reason="error"
          title="Couldn't load the slots"
          description="Check your connection and try again."
          action={{ label: "Retry", onClick: () => grid.refetch() }}
        />
      ) : (
        <SlotGrid
          slots={grid.data ?? []}
          mode="staff"
          attendedPendingId={pendingId}
          onToggleAttended={(bookingId, attended) => {
            if (setAttended.isPending) return;
            setPendingId(bookingId);
            setAttended.mutate({ bookingId, attended }, { onSettled: () => setPendingId(null) });
          }}
          onRemarks={hat === "teacher" ? (id, name) => setRemarksFor({ id, name }) : undefined}
          disabled={setAttended.isPending}
        />
      )}

      <MobileSheet
        open={!!remarksFor}
        onOpenChange={(open) => !open && setRemarksFor(null)}
        title="Remarks"
        subtitle={remarksFor?.name}
        icon={<MessageSquare className="h-5 w-5" />}
        desktopWidth="md"
      >
        <div className="p-4">
          {remarksFor && (
            <StudentRemarksPanel
              studentId={remarksFor.id}
              studentName={remarksFor.name}
              institutionId={institutionId}
            />
          )}
        </div>
      </MobileSheet>
    </section>
  );
}
