import { ArrowLeft, KeyRound, Loader2 } from "lucide-react";
import { NavLink } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadBatches } from "@/hooks/olympiad/useOlympiadBatches";
import { PinCustodyTable } from "@/components/olympiad/school/PinCustodyTable";

export default function OlympiadSchoolPinCustodyPage() {
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: batches, isLoading: batchesLoading } = useOlympiadBatches(school?.id);

  if (schoolLoading) {
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

  return (
    <PageShell>
      <NavLink
        to="/school/olympiad/exam-planning"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Exam Planning
      </NavLink>

      <PageHeader
        title="PIN Custody"
        subtitle={school.institution_name}
        icon={<KeyRound className="h-6 w-6" />}
      />

      <div className="space-y-4 py-4">
        <div className="flex items-center justify-end">
          <NavLink to="/school/olympiad/batches">
            <Button size="sm" variant="outline">View schedule</Button>
          </NavLink>
        </div>

        {batchesLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : (
          <PinCustodyTable batches={batches ?? []} />
        )}
      </div>
    </PageShell>
  );
}
