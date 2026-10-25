import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Medal, Settings } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { MobileTabs } from "@/components/shared/nav/MobileTabs";
import { CampaignSettingsSheet } from "@/components/olympiad/admin/CampaignSettingsSheet";

const TABS = [
  { value: "schools", label: "Schools",       path: "/admin/olympiad/schools" },
  { value: "classes", label: "Exam Settings", path: "/admin/olympiad/classes" },
] as const;

type TabValue = typeof TABS[number]["value"];

function resolveActive(pathname: string): TabValue {
  if (pathname.startsWith("/admin/olympiad/classes")) return "classes";
  return "schools";
}

export default function OlympiadAdminPage() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = resolveActive(pathname);
  const [campaignOpen, setCampaignOpen] = useState(false);

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle="Participating schools and exam settings"
        icon={<Medal className="h-6 w-6" />}
        primaryAction={{
          label: "Campaign Settings",
          icon: <Settings className="h-4 w-4" />,
          onClick: () => setCampaignOpen(true),
        }}
      />
      <MobileTabs
        value={active}
        onValueChange={(v) => {
          const tab = TABS.find((t) => t.value === v);
          if (tab) navigate(tab.path);
        }}
        options={TABS.map((t) => ({ value: t.value, label: t.label }))}
        className="mb-4"
      />
      <Outlet />
      <CampaignSettingsSheet open={campaignOpen} onOpenChange={setCampaignOpen} />
    </PageShell>
  );
}
