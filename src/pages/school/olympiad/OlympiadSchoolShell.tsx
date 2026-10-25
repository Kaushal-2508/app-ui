import { Suspense, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Medal, Loader2, Lock, CalendarClock } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { OlympiadStageStepper } from "@/components/olympiad/school/OlympiadStageStepper";
import { resolveOlympiadStage } from "@/components/olympiad/school/olympiadStage";
import { CloseEnrollmentDialog } from "@/components/olympiad/school/CloseEnrollmentDialog";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";

type Tab = { value: string; label: string; path: string };

/** Context handed to tab pages via <Outlet/> — lets them trigger shell-owned
 *  UI (e.g. the AI suggestion's "Close enrollment" CTA opens the header's
 *  dialog). Consume with useOutletContext<OlympiadShellOutletContext>(). */
export type OlympiadShellOutletContext = {
  openCloseEnrollment: () => void;
};

// Primary navigation: plain-language destinations. Everything exam-day
// related (schedule, PINs, absentees) is launched from the "Exam Planning"
// tile grid as full standalone pages (PIN custody is admin-only at the
// route level — see App.tsx). People + capacity (teachers, students,
// labs & PCs) launch from "Resource Planning"; outreach formats (link,
// flyer, messages) live under "Marketing Material".
const PRIMARY_TABS: Tab[] = [
  { value: "home",      label: "Home",               path: "/school/olympiad" },
  { value: "resources", label: "Resource Planning",  path: "/school/olympiad/resource-planning" },
  { value: "planning",  label: "Exam Planning",      path: "/school/olympiad/exam-planning" },
  { value: "report",    label: "Analytics",          path: "/school/olympiad/report" },
  { value: "revenue",   label: "Revenue",            path: "/school/olympiad/revenue" },
  { value: "marketing", label: "Marketing Material", path: "/school/olympiad/marketing" },
];

function resolveActive(pathname: string): string {
  if (pathname.startsWith("/school/olympiad/resource-planning")) return "resources";
  if (pathname.startsWith("/school/olympiad/exam-planning")) return "planning";
  if (pathname.startsWith("/school/olympiad/report")) return "report";
  if (pathname.startsWith("/school/olympiad/revenue")) return "revenue";
  if (pathname.startsWith("/school/olympiad/marketing")) return "marketing";
  return "home";
}

export default function OlympiadSchoolShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: school } = useOlympiadMySchool();
  const [closeOpen, setCloseOpen] = useState(false);

  // Close enrollment / Manage closing date sits top-right in the header —
  // visible from every tab. Once enrollment closes (stage 2+), the button
  // stays visible but locks as a read-only "Enrollment closed" state.
  const enrollmentOpen = !!school && resolveOlympiadStage(school) === 1;

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle={school?.institution_name}
        icon={<Medal className="h-6 w-6" />}
        primaryAction={
          !school
            ? undefined
            : enrollmentOpen
              ? {
                  label: school.enrollment_closes_at ? "Manage closing date" : "Close enrollment",
                  icon: school.enrollment_closes_at
                    ? <CalendarClock className="h-4 w-4" />
                    : <Lock className="h-4 w-4" />,
                  onClick: () => setCloseOpen(true),
                }
              : {
                  label: "Enrollment closed",
                  icon: <Lock className="h-4 w-4" />,
                  disabled: true,
                }
        }
      />
      {school && (
        <section className="surface-card frosted-shadow rounded-card mb-4 px-4 py-4 sm:px-6">
          <OlympiadStageStepper stage={resolveOlympiadStage(school)} />
        </section>
      )}
      <MobileTabs
        value={resolveActive(pathname)}
        onValueChange={(v) => {
          const tab = PRIMARY_TABS.find((t) => t.value === v);
          if (tab) navigate(tab.path);
        }}
        options={PRIMARY_TABS.map((t) => ({ value: t.value, label: t.label }))}
        className="mb-4"
      />
      <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>}>
        <Outlet context={{ openCloseEnrollment: () => setCloseOpen(true) } satisfies OlympiadShellOutletContext} />
      </Suspense>
      {school && (
        <CloseEnrollmentDialog
          open={closeOpen}
          onOpenChange={setCloseOpen}
          olySchoolId={school.id}
          scheduledCloseAt={school.enrollment_closes_at}
        />
      )}
    </PageShell>
  );
}
