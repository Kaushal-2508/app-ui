import { useState } from "react";
import { useNavigate, NavLink } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { PinEntryForm } from "@/components/olympiad/student/PinEntryForm";
import { InstructionsScreen } from "@/components/olympiad/student/InstructionsScreen";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";

export default function OlympiadStudentPinEntryPage() {
  const navigate = useNavigate();
  const { data: ctx, isLoading } = useOlympiadStudentDashboard();
  const [pinValidated, setPinValidated] = useState(false);

  if (isLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      </PageShell>
    );
  }
  if (!ctx?.ok) {
    return (
      <PageShell>
        <p className="py-6 text-sm text-ink-600">No active enrollment.</p>
      </PageShell>
    );
  }

  // Look up exam duration from the campaign — Phase 4a uses a sensible 90-minute default
  // and Phase 4b can wire a campaign-context RPC if needed.
  const examDurationMinutes = 90;

  return (
    <PageShell>
      <NavLink
        to="/student/olympiad"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title="Start exam" subtitle={`Roll ${ctx.student.roll_number}`} />
      <div className="py-4">
        {!pinValidated ? (
          <PinEntryForm onSuccess={() => setPinValidated(true)} />
        ) : (
          <InstructionsScreen
            examDurationMinutes={examDurationMinutes}
            onProceed={() => navigate("/student/olympiad/exam")}
          />
        )}
      </div>
    </PageShell>
  );
}
