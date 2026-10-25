import { useParams, NavLink } from "react-router-dom";
import { Loader2, ArrowLeft } from "lucide-react";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { useOlympiadStudentDashboard } from "@/hooks/olympiad/useOlympiadStudentDashboard";
import { useOlympiadStudentStudyMaterials } from "@/hooks/olympiad/useOlympiadStudentStudyMaterials";
import { StudyMaterialItem } from "@/components/olympiad/student/StudyMaterialItem";

export default function OlympiadStudentStudyPage() {
  const { subjectId } = useParams();
  const { data: ctx } = useOlympiadStudentDashboard();
  const subjectIds = ctx?.ok && subjectId ? [subjectId] : undefined;
  const gradeLevelId = ctx?.ok ? ctx.student.grade_level_id : undefined;
  const { data: materials, isLoading } = useOlympiadStudentStudyMaterials(subjectIds, gradeLevelId);

  const subject = ctx?.ok ? ctx.subjects.find((s) => s.id === subjectId) : null;

  return (
    <PageShell>
      <NavLink
        to="/student/olympiad"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Dashboard
      </NavLink>
      <PageHeader title={subject?.name ?? "Study material"} subtitle="Concept notes for your subject" />
      <div className="space-y-2 py-4">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : (materials ?? []).length === 0 ? (
          <p className="text-sm text-ink-600 py-6 text-center">
            No study material uploaded yet for this subject.
          </p>
        ) : (
          (materials ?? []).map((m) => <StudyMaterialItem key={m.id} material={m} />)
        )}
      </div>
    </PageShell>
  );
}
