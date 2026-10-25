import { NavLink } from "react-router-dom";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";

export default function OlympiadExamSubmittedPage() {
  return (
    <PageShell>
      <PageHeader title="Exam submitted" />
      <div className="surface-card frosted-shadow rounded-card p-8 sm:p-10 text-center max-w-md mx-auto mt-6 space-y-4">
        <CheckCircle2 className="h-14 w-14 text-emerald-500 mx-auto" />
        <h1 className="text-xl font-bold text-ink-900">Exam submitted successfully</h1>
        <p className="text-sm text-ink-700">
          Your results will be published soon by your school. You will receive an email when they are ready.
        </p>
        <NavLink to="/student/olympiad">
          <Button className="w-full">
            Back to dashboard
            <ArrowRight className="h-4 w-4 ml-2" />
          </Button>
        </NavLink>
      </div>
    </PageShell>
  );
}
