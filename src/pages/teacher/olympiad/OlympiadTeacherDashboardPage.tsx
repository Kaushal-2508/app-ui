// src/pages/teacher/olympiad/OlympiadTeacherDashboardPage.tsx
import { Loader2, Medal } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadAssignedClasses } from "@/hooks/olympiad/useOlympiadAssignedClasses";
import { ClassCard } from "@/components/olympiad/teacher/ClassCard";
import { useAuth } from "@/hooks/useAuth";

export default function OlympiadTeacherDashboardPage() {
  const { user } = useAuth();
  const { data: classes, isLoading } = useOlympiadAssignedClasses();

  return (
    <PageShell>
      <PageHeader
        title="SALCI Olympiad"
        subtitle={user?.email ? `Welcome, ${user.email.split("@")[0]}` : "Your classes"}
      />
      <div className="space-y-3 py-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : (classes ?? []).length === 0 ? (
          <EmptyState
            icon={<Medal className="h-8 w-8" />}
            title="No classes assigned"
            description="Ask your school admin to assign you to an Olympiad class."
          />
        ) : (
          <>
            <p className="eyebrow">My classes</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(classes ?? []).map((c) => (
                <ClassCard key={c.assignment_id} cls={c} />
              ))}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
