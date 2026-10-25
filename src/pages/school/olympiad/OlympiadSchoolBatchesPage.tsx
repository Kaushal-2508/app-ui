import { NavLink, useNavigate } from "react-router-dom";
import { ArrowLeft, CalendarDays, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadBatches } from "@/hooks/olympiad/useOlympiadBatches";
import { BatchBuilder } from "@/components/olympiad/school/BatchBuilder";
import { BatchScheduleBoard } from "@/components/olympiad/school/BatchScheduleBoard";

export default function OlympiadSchoolBatchesPage() {
  const navigate = useNavigate();
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: batches, isLoading: batchesLoading } = useOlympiadBatches(school?.id);

  if (schoolLoading || batchesLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      </PageShell>
    );
  }

  if (!school) {
    return (
      <PageShell>
        <p className="py-6 text-sm text-ink-600">No active Olympiad campaign.</p>
      </PageShell>
    );
  }

  const schoolStatus = school.status;
  const hasLocked = (batches ?? []).some(
    (b) => b.status !== "cancelled" && !b.is_absentees,
  );

  return (
    <PageShell>
      <NavLink
        to="/school/olympiad/exam-planning"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Exam Planning
      </NavLink>

      <PageHeader
        title="Batch Schedule"
        subtitle={school.institution_name}
        icon={<CalendarDays className="h-6 w-6" />}
      />

      <div className="space-y-4 py-4">

      {/* State 1: enrollment still open */}
      {schoolStatus === "enrollment_open" && (
        <div className="surface-card frosted-shadow rounded-card p-6 text-center space-y-2">
          <p className="text-sm text-ink-600">
            Close enrollment first before scheduling batches.
          </p>
          <Button variant="link" onClick={() => navigate("/school/olympiad")}>
            Go to dashboard
          </Button>
        </div>
      )}

      {/* State 2: enrollment closed, not yet locked — manual two-panel builder */}
      {schoolStatus === "enrollment_closed" && !hasLocked && <BatchBuilder school={school} />}

      {/* State 3: batches locked — full schedule board with attendance */}
      {hasLocked && (
        <BatchScheduleBoard
          olySchoolId={school.id}
          batches={batches ?? []}
          onOpenPinCustody={() => navigate("/school/olympiad/pin-custody")}
        />
      )}
      </div>
    </PageShell>
  );
}
