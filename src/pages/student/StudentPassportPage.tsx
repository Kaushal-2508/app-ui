import { Trophy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { StudentLearningPassport } from "@/components/passport";

import { PageShell, PageHeader } from "@/components/shared/page";

export default function StudentPassportPage() {
  const { user } = useAuth();

  return (
    <PageShell>
      <PageHeader
        icon={<Trophy className="h-5 w-5" />}
        title="My Learning Passport"
        subtitle="Your complete academic journey and subject capabilities"
      />
      <StudentLearningPassport studentId={user?.id} expanded={true} />
    </PageShell>
  );
}
