import { NavLink } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadPublishJob } from "@/hooks/olympiad/useOlympiadPublishJob";
import { PublishJobStatus } from "@/components/olympiad/school/PublishJobStatus";

export default function OlympiadSchoolPublishStatusPage() {
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: job, isLoading: jobLoading } = useOlympiadPublishJob(school?.id);

  if (schoolLoading || jobLoading) {
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
        <p className="py-6 text-sm text-ink-600">No active campaign.</p>
      </PageShell>
    );
  }

  if (!job) {
    return (
      <PageShell>
        <NavLink
          to="/school/olympiad"
          className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
        >
          <ArrowLeft className="h-4 w-4" /> Dashboard
        </NavLink>
        <PageHeader title="Publish status" />
        <p className="py-6 text-sm text-ink-600">
          No publish job has been started for this school yet.
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <NavLink
        to="/school/olympiad"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title="Publish status" subtitle={school.institution_name} />
      <div className="py-4">
        <PublishJobStatus job={job} />
        {job.status === "completed" && (
          <div className="mt-4 flex justify-center">
            <NavLink to="/school/olympiad">
              <Button>Back to dashboard</Button>
            </NavLink>
          </div>
        )}
      </div>
    </PageShell>
  );
}
