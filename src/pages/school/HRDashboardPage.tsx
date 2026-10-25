import { useState } from "react";
import { StaffDirectoryTab } from "@/components/hr/StaffDirectoryTab";
import { SalaryStructuresTab } from "@/components/hr/SalaryStructuresTab";
import { SalaryAssignmentsTab } from "@/components/hr/SalaryAssignmentsTab";
import { StaffDocumentsTab } from "@/components/hr/StaffDocumentsTab";
import { StaffLeavePanel } from "@/components/hr/StaffLeavePanel";
import { PayrollRunPanel } from "@/components/hr/PayrollRunPanel";
import { HolidayCalendarPanel } from "@/components/hr/HolidayCalendarPanel";
import { Briefcase } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileTabs, type MobileTabOption } from "@/components/shared/nav";

type TabValue =
  | "directory"
  | "documents"
  | "structures"
  | "assignments"
  | "leave"
  | "payroll"
  | "holidays";

const TAB_OPTIONS: MobileTabOption[] = [
  { value: "directory", label: "Staff Directory" },
  { value: "documents", label: "Documents" },
  { value: "structures", label: "Salary Structures" },
  { value: "assignments", label: "Salary Assignments" },
  { value: "leave", label: "Leave Management" },
  { value: "payroll", label: "Payroll" },
  { value: "holidays", label: "Holiday Calendar" },
];

export default function HRDashboardPage() {
  const [activeTab, setActiveTab] = useState<TabValue>("directory");

  return (
    <PageShell>
      <PageHeader
        icon={<Briefcase className="h-5 w-5" />}
        title="HR & Payroll"
        subtitle="Manage staff, salaries, leave, and payroll"
      />

      <div className="mt-2">
        <MobileTabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as TabValue)}
          options={TAB_OPTIONS}
        />
      </div>

      <div className="mt-4">
        {activeTab === "directory" && <StaffDirectoryTab />}
        {activeTab === "documents" && <StaffDocumentsTab />}
        {activeTab === "structures" && <SalaryStructuresTab />}
        {activeTab === "assignments" && <SalaryAssignmentsTab />}
        {activeTab === "leave" && <StaffLeavePanel />}
        {activeTab === "payroll" && <PayrollRunPanel />}
        {activeTab === "holidays" && <HolidayCalendarPanel />}
      </div>
    </PageShell>
  );
}
