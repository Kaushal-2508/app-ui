import { useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  ChevronRight,
  Info,
  Loader2,
  MessageSquareHeart,
  SearchX,
  Wrench,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader, PageShell } from "@/components/shared/page";
import { EmptyState, ListRow } from "@/components/shared/surfaces";
import { PTMFeedbackForm } from "@/components/ptm/PTMFeedbackForm";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { formatPTMDate, formatTimeRange } from "@/lib/ptm";
import {
  usePTMFeatureGate,
  usePTMFeedbackByToken,
  usePTMOpenForFeedback,
  usePTMSchemaReady,
  type PTMFeedbackContext,
} from "@/hooks/ptm";

interface Props {
  /** "token": the per-PTM QR, `/ptm/feedback/:token`. "active": the one
   *  permanent QR, `/ptm/feedback/active`, which opens whichever meeting is
   *  taking feedback for the child's class right now. */
  mode: "token" | "active";
}

/**
 * Family feedback. Both routes render the same PTMFeedbackForm, so the
 * single-QR approach needs no rework later. Signed-out visitors are sent to
 * the login page by ProtectedRoute and brought back here afterwards.
 *
 * NEEDS CORE: the two routes are registered in App.tsx by Tushar (spec
 * docs/superpowers/specs/2026-09-28-ptm-module-design.md).
 */
export default function PTMFeedbackPage({ mode }: Props) {
  const navigate = useNavigate();
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const gate = usePTMFeatureGate();
  const probe = usePTMSchemaReady(gate.enabled && !gate.isLoading);

  const isStudent = Boolean(roleInfo?.isStudent);
  const canQuery = probe.ready && !!user;
  const byToken = usePTMFeedbackByToken(mode === "token" && canQuery ? token ?? null : null);
  const openList = usePTMOpenForFeedback(mode === "active" && canQuery && isStudent);
  const [pickedId, setPickedId] = useState<string | null>(null);

  const header = (
    <PageHeader
      title="Meeting feedback"
      subtitle="Tell the school how your parent-teacher meeting went"
      icon={<MessageSquareHeart className="h-5 w-5" />}
    />
  );

  const spinner = (
    <div className="flex min-h-[40vh] items-center justify-center" aria-busy="true">
      <Loader2 className="h-8 w-8 animate-spin text-ink-500" aria-label="Loading" />
    </div>
  );

  const shell = (body: ReactNode) => (
    <PageShell>
      {header}
      <div className="mt-4">{body}</div>
    </PageShell>
  );

  const renderForm = (context: PTMFeedbackContext, onPickAnother?: () => void) =>
    shell(
      <section className="surface-card frosted-shadow rounded-card max-w-2xl p-4 sm:p-6">
        {onPickAnother && (
          <Button variant="ghost" size="sm" className="-ml-2 mb-2" onClick={onPickAnother}>
            Choose a different meeting
          </Button>
        )}
        <h2 className="mb-4 text-lg font-semibold text-ink-900">{context.title}</h2>
        {user && <PTMFeedbackForm context={context} userId={user.id} />}
      </section>,
    );

  if (roleLoading || gate.isLoading || !gate.enabled || probe.isLoading) {
    // A disabled feature is redirected by usePTMFeatureGate; hold the spinner.
    return shell(spinner);
  }

  if (!probe.ready) {
    return shell(
      <EmptyState
        icon={<Wrench className="h-7 w-7" />}
        reason="noData"
        title="Feedback isn't set up for your school yet"
        description="Please try again later, or tell the teachers in person."
      />,
    );
  }

  const staffNote = (description: string, ptmId?: string) =>
    shell(
      <EmptyState
        icon={<Info className="h-7 w-7" />}
        tone="sky"
        reason="noData"
        title="This page is for families"
        description={description}
        action={
          ptmId
            ? {
                label: "Open this PTM",
                onClick: () => navigate(`/school/communication?tab=ptm&ptm=${ptmId}`),
              }
            : undefined
        }
      />,
    );

  if (mode === "token") {
    if (byToken.isLoading) return shell(spinner);
    if (byToken.isError) {
      return shell(
        <EmptyState
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          reason="error"
          title="Couldn't open the feedback form"
          description="Check your connection and try again."
          action={{ label: "Retry", onClick: () => byToken.refetch() }}
        />,
      );
    }
    if (!byToken.data) {
      return shell(
        <EmptyState
          icon={<SearchX className="h-7 w-7" />}
          reason="noData"
          title="We couldn't find this meeting for your account"
          description="Check that you are signed in with your child's account and that the QR code is for their class."
        />,
      );
    }
    if (!isStudent) {
      return staffNote(
        "Families see the feedback form here after scanning the QR code. Responses show on the PTM's Feedback tab.",
        byToken.data.ptm_id,
      );
    }
    return renderForm(byToken.data);
  }

  // mode === "active"
  if (!isStudent) {
    return staffNote(
      "Families reach this page from the school's permanent QR code. It opens whichever meeting is taking feedback for their child's class.",
    );
  }
  if (openList.isLoading) return shell(spinner);
  if (openList.isError) {
    return shell(
      <EmptyState
        icon={<AlertTriangle className="h-7 w-7" />}
        tone="rose"
        reason="error"
        title="Couldn't check for open meetings"
        description="Check your connection and try again."
        action={{ label: "Retry", onClick: () => openList.refetch() }}
      />,
    );
  }

  const open = openList.data ?? [];
  if (open.length === 0) {
    return shell(
      <EmptyState
        icon={<CalendarClock className="h-7 w-7" />}
        reason="noData"
        title="No meeting is open for feedback right now"
        description="Feedback opens when a meeting starts. If you just had one, check that you are signed in with your child's account."
      />,
    );
  }
  if (open.length === 1) return renderForm(open[0]);

  const picked = open.find((c) => c.ptm_id === pickedId);
  if (picked) return renderForm(picked, () => setPickedId(null));

  // ListRow brings its own card surface, so the list is not wrapped in another.
  return shell(
    <section className="max-w-2xl space-y-3">
      <p className="text-sm text-ink-600">
        More than one meeting is taking feedback. Which one is this about?
      </p>
      <ul className="space-y-2">
        {open.map((c) => (
          <ListRow
            key={c.ptm_id}
            as="li"
            title={c.title}
            subtitle={`${formatPTMDate(c.scheduled_date)}, ${formatTimeRange(c.start_time, c.end_time)}${c.my_feedback ? " · Sent" : ""}`}
            trailing={<ChevronRight className="h-4 w-4 text-ink-400" aria-hidden="true" />}
            onClick={() => setPickedId(c.ptm_id)}
          />
        ))}
      </ul>
    </section>,
  );
}
