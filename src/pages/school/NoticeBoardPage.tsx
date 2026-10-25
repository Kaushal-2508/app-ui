import { Megaphone } from "lucide-react";

import { PageHeader, PageShell } from "@/components/shared/page";
import { NoticeBoard } from "@/components/notices";

/**
 * Dedicated route for the Notice Board. The Communication page renders the same
 * <NoticeBoard /> in its tab, so both entry points share one implementation.
 */
export default function NoticeBoardPage() {
  return (
    <PageShell>
      <PageHeader
        title="Notice Board"
        subtitle="Notices sent to you, and the ones you have issued"
        icon={<Megaphone className="h-5 w-5" />}
      />
      <NoticeBoard />
    </PageShell>
  );
}
