import { Link } from "react-router-dom";
import { Loader2, CalendarDays, KeyRound, UserX, BookOpen, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeatureTile } from "@/components/shared/surfaces";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useUserRole } from "@/hooks/useUserRole";

/**
 * "Exam Planning" tab of the school-admin Olympiad flow: everything between
 * onboarding and exam day. Pure launcher — each tile opens its own full page.
 * (Share enrollment link moved to the Marketing Material tab.)
 */
export default function OlympiadSchoolExamPlanningPage() {
  const { data: school, isLoading } = useOlympiadMySchool();
  const { data: roleInfo } = useUserRole();

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>;
  }
  if (!school) {
    return (
      <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
        This institution is not currently enrolled in the SALCI Olympiad. Please contact SALCI to onboard.
      </div>
    );
  }

  const isAdmin = roleInfo?.isSchoolAdmin === true || roleInfo?.isSuperAdmin === true;

  return (
    <div className="space-y-3 py-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Exam planning</p>
          <h2 className="text-base font-semibold text-ink-900">Get ready for exam day</h2>
        </div>
        {/* Always available — not gated by exam stage */}
        <Button asChild variant="outline" size="sm">
          <Link to="/school/olympiad/exam-paper">
            <FileText className="mr-1.5 h-4 w-4" />
            View Exam
          </Link>
        </Button>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <FeatureTile
          to="/school/olympiad/batches"
          icon={<CalendarDays className="h-5 w-5" />}
          title="Exam schedule"
          description="Build batches with dates and times"
          tone="sky"
        />
        {isAdmin && (
          <FeatureTile
            to="/school/olympiad/pin-custody"
            icon={<KeyRound className="h-5 w-5" />}
            title="Exam PINs"
            description="Reveal entry PINs to supervisors on exam day"
            tone="mint"
          />
        )}
        <FeatureTile
          to="/school/olympiad/absentees"
          icon={<UserX className="h-5 w-5" />}
          title="Absentees"
          description="Mark no-shows and reschedule them into a new batch"
          tone="rose"
        />
        <FeatureTile
          to="/school/olympiad/study-material"
          icon={<BookOpen className="h-5 w-5" />}
          title="Study Material"
          description="Subject-wise PDFs students prepare from"
          tone="violet"
        />
      </div>
    </div>
  );
}
