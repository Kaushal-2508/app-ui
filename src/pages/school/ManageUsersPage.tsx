import { useSearchParams } from "react-router-dom";
import { Users } from "lucide-react";
import ManageAdminsPage from "./ManageAdminsPage";
import SchoolCoordinatorsPage from "./SchoolCoordinatorsPage";
import SchoolTeachersPage from "./SchoolTeachersPage";
import SchoolStudentsPage from "./SchoolStudentsPage";

import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileTabs } from "@/components/shared/nav";

const VALID_TABS = ["admins", "coordinators", "teachers", "students"] as const;
type TabValue = (typeof VALID_TABS)[number];

const TAB_OPTIONS: { value: TabValue; label: string }[] = [
  { value: "admins", label: "Admins" },
  { value: "coordinators", label: "Coordinators" },
  { value: "teachers", label: "Teachers" },
  { value: "students", label: "Students" },
];

export default function ManageUsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab") as TabValue | null;
  const activeTab: TabValue =
    tabParam && VALID_TABS.includes(tabParam) ? tabParam : "admins";

  const handleTabChange = (value: string) => {
    setSearchParams({ tab: value }, { replace: true });
  };

  return (
    <PageShell>
      <PageHeader
        icon={<Users className="h-5 w-5" />}
        title="Manage Users"
        subtitle="Manage all users in your institution"
      />

      <div className="mt-2">
        <MobileTabs
          value={activeTab}
          onValueChange={handleTabChange}
          options={TAB_OPTIONS}
        />
      </div>

      <div className="mt-4">
        {activeTab === "admins" && <ManageAdminsPage />}
        {activeTab === "coordinators" && <SchoolCoordinatorsPage />}
        {activeTab === "teachers" && <SchoolTeachersPage />}
        {activeTab === "students" && <SchoolStudentsPage />}
      </div>
    </PageShell>
  );
}
