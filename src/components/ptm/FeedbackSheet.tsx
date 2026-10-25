import { useState } from "react";
import { AlertTriangle, Loader2, MessageSquareHeart, SearchX } from "lucide-react";

import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { PTMFeedbackForm } from "./PTMFeedbackForm";
import { useAuth } from "@/hooks/useAuth";
import { usePTMFeedbackByToken, type PTMSchedule } from "@/hooks/ptm";

interface Props {
  ptm: PTMSchedule | null;
  onClose: () => void;
}

/**
 * The in-app way into the feedback form, from the student's PTM card. It
 * resolves the same token the printed QR carries, so both paths run through
 * one RPC and one form; no route is needed for this one.
 */
export function FeedbackSheet({ ptm, onClose }: Props) {
  const { user } = useAuth();
  // Hold the last meeting through the close animation: as `ptm` goes null the
  // query would disable and the body flash "isn't open to your account".
  const [shown, setShown] = useState(ptm);
  if (ptm && ptm !== shown) setShown(ptm);
  const context = usePTMFeedbackByToken(shown?.feedback_token ?? null);

  return (
    <MobileSheet
      open={!!ptm}
      onOpenChange={(open) => !open && onClose()}
      title="Meeting feedback"
      subtitle={shown?.title}
      icon={<MessageSquareHeart className="h-5 w-5" />}
      desktopWidth="md"
    >
      {/* No padding of its own: the sheet body's px-5 py-4 is the gutter, and
          the form's sticky action bar is measured against it. */}
      {context.isLoading ? (
        <div className="flex items-center justify-center py-12" aria-busy="true">
          <Loader2 className="h-6 w-6 animate-spin text-ink-500" aria-label="Loading" />
        </div>
      ) : context.isError && !context.data ? (
        // A failed background refetch keeps the form it already has.
        <EmptyState
          size="sm"
          icon={<AlertTriangle className="h-7 w-7" />}
          tone="rose"
          reason="error"
          title="Couldn't open the feedback form"
          description="Check your connection and try again."
          action={{ label: "Retry", onClick: () => context.refetch() }}
        />
      ) : !context.data || !user ? (
        <EmptyState
          size="sm"
          icon={<SearchX className="h-7 w-7" />}
          reason="noData"
          title="This meeting isn't open to your account"
          description="Feedback is for the classes the meeting was scheduled for."
        />
      ) : (
        <PTMFeedbackForm context={context.data} userId={user.id} onDone={onClose} stickyActions />
      )}
    </MobileSheet>
  );
}
