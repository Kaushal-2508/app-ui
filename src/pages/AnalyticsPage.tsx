import { useState } from "react";
import { BarChart3 } from "lucide-react";

import { TeacherAnalyticsDashboard } from "@/components/analytics/TeacherAnalyticsDashboard";
import { SuperAdminAnalyticsDashboard } from "@/components/analytics/SuperAdminAnalyticsDashboard";
import { SchoolAnalyticsView } from "@/components/analytics/school/SchoolAnalyticsView";
import { IntegrityTab } from "@/components/analytics/school/IntegrityTab";
import { useUserRole } from "@/hooks/useUserRole";
import {
  ANALYTICS_RANGES,
  DEFAULT_ANALYTICS_RANGE,
  type AnalyticsRange,
} from "@/hooks/useSchoolAnalytics";
import { EmptyState } from "@/components/shared/surfaces";
import { FilterRow, MobileTabs } from "@/components/shared/nav";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageShell } from "@/components/shared/page";

const SUPER_TABS = [
  { value: "system", label: "System" },
  { value: "integrity", label: "Integrity" },
  { value: "school-view", label: "School view" },
] as const;

type SuperTab = (typeof SUPER_TABS)[number]["value"];

/**
 * Super admin. "School view" is the exact surface a school admin sees with an
 * institution picker in front of it, so the two can never drift apart;
 * "Integrity" is the same proctoring tab widened to every institution.
 */
function SuperAdminAnalyticsView() {
  const [activeTab, setActiveTab] = useState<SuperTab>("system");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [range, setRange] = useState<AnalyticsRange>(DEFAULT_ANALYTICS_RANGE);

  const tabStrip = (
    <MobileTabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as SuperTab)}
      options={SUPER_TABS.map((t) => ({ value: t.value, label: t.label }))}
    />
  );

  // School view brings its own header. Wrapping it in this PageShell keeps the
  // strip on the same gradient and the same content column; the inner PageShell
  // detects the nesting and passes its children straight through rather than
  // double-padding them.
  if (activeTab === "school-view") {
    return (
      <PageShell>
        {tabStrip}
        <SchoolAnalyticsView
          institutionId={institutionId}
          showInstitutionPicker
          onInstitutionChange={setInstitutionId}
        />
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="System Analytics"
        subtitle="Across every institution on the platform"
        density="compact"
      />
      <div className="mt-2">{tabStrip}</div>
      <div className="mt-4">
        {activeTab === "system" && <SuperAdminAnalyticsDashboard />}
        {activeTab === "integrity" && (
          <>
            <FilterRow className="mb-3">
              <Select value={range} onValueChange={(v) => setRange(v as AnalyticsRange)}>
                <SelectTrigger
                  aria-label="Period"
                  className="h-10 w-[164px] shrink-0 rounded-full text-sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {ANALYTICS_RANGES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FilterRow>
            <IntegrityTab institutionId={null} range={range} classId={null} platform />
          </>
        )}
      </div>
    </PageShell>
  );
}

export default function AnalyticsPage() {
  const { data: userRole } = useUserRole();
  const role = userRole?.primaryRole;
  const institutionId = userRole?.institutionId;

  if (role === "super_admin") {
    return <SuperAdminAnalyticsView />;
  }

  if (role === "school_admin" || role === "super_school_admin") {
    return <SchoolAnalyticsView institutionId={institutionId ?? null} />;
  }

  if (role === "teacher" || role === "coordinator") {
    return (
      <PageShell>
        <PageHeader
          icon={<BarChart3 className="h-5 w-5" />}
          title="Teaching Analytics"
          subtitle="Class performance and question insights"
        />
        <div className="mt-4">
          <TeacherAnalyticsDashboard />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" />}
        title="Analytics"
        subtitle="Performance insights and trends"
      />
      <div className="mt-4">
        <EmptyState
          icon={<BarChart3 className="h-7 w-7" />}
          title="Analytics is not available for your role"
          description="Ask a school admin if you need access to performance reporting."
          tone="teal"
        />
      </div>
    </PageShell>
  );
}
