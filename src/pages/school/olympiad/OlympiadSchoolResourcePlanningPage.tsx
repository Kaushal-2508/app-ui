import { Loader2, UserPlus, GraduationCap, Users, Monitor } from "lucide-react";
import { FeatureTile } from "@/components/shared/surfaces";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";

/**
 * "Resource Planning" tab of the school-admin Olympiad flow: the people and
 * capacity needed to run the Olympiad — teachers, students, and the computer
 * labs the exam will run on. Tiles deep-link with router state so the
 * matching sheet opens as soon as the page loads.
 */
export default function OlympiadSchoolResourcePlanningPage() {
  const { data: school, isLoading } = useOlympiadMySchool();

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

  const isOnboarded = school.is_existing_salci_school === false;
  const labCount = Array.isArray(school.lab_pc_counts) ? school.lab_pc_counts.length : 0;
  const labsDescription =
    school.pc_count && school.pc_count > 0
      ? `${school.pc_count} PC${school.pc_count === 1 ? "" : "s"} across ${labCount || 1} lab${labCount > 1 ? "s" : ""} set up for exam day`
      : "Tell us how many labs and PCs are available for exam day";

  return (
    <div className="space-y-3 py-4">
      <header>
        <p className="eyebrow">Resource planning</p>
        <h2 className="text-base font-semibold text-ink-900">People and capacity for the Olympiad</h2>
      </header>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
        {isOnboarded ? (
          <FeatureTile
            to="/school/olympiad/teachers"
            state={{ openAdd: true }}
            icon={<GraduationCap className="h-5 w-5" />}
            title="Teacher Onboarding"
            description="Create teacher accounts with login credentials"
            tone="violet"
          />
        ) : (
          <FeatureTile
            to="/school/olympiad/teachers"
            icon={<GraduationCap className="h-5 w-5" />}
            title="Teacher Onboarding"
            description="Pick SALCI teachers to run Olympiad classes"
            tone="violet"
          />
        )}
        {isOnboarded ? (
          <FeatureTile
            to="/school/olympiad/students"
            state={{ openEnroll: true }}
            icon={<UserPlus className="h-5 w-5" />}
            title="Students Onboarding"
            description="Enroll students and hand over their sign-in details"
            tone="teal"
          />
        ) : (
          <FeatureTile
            to="/school/olympiad/students"
            icon={<Users className="h-5 w-5" />}
            title="Students Onboarding"
            description="Roster of enrolled students by class"
            tone="teal"
          />
        )}
        <FeatureTile
          to="/school/olympiad/labs"
          icon={<Monitor className="h-5 w-5" />}
          title="Labs & PCs"
          description={labsDescription}
          tone="sky"
        />
      </div>
    </div>
  );
}
