import { useMemo, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Medal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadSubjects, type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { SubjectListRow } from "@/components/olympiad/admin/SubjectListRow";
import { SubjectEditorSheet } from "@/components/olympiad/admin/SubjectEditorSheet";

export default function OlympiadClassDetailPage() {
  const { gradeLevelId } = useParams();
  const { data: subjects, isLoading } = useOlympiadSubjects();
  const { data: classes } = useOlympiadClasses();
  const [editorOpen, setEditorOpen] = useState(false);

  const klass = classes?.find((c) => c.grade_level_id === gradeLevelId);
  const classSubjects = useMemo(
    () => (subjects ?? []).filter((s) => (gradeLevelId ? s.grade_level_ids.includes(gradeLevelId) : false)),
    [subjects, gradeLevelId],
  );

  // Create-mode seed with this grade pre-ticked (id:"" => insert).
  const seedSubject: OlympiadSubject = {
    id: "",
    name: "",
    description: null,
    status: "active",
    grade_level_ids: gradeLevelId ? [gradeLevelId] : [],
  };

  return (
    <div className="space-y-4 py-4">
      <NavLink to="/admin/olympiad/classes" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900">
        <ArrowLeft className="h-4 w-4" />
        All classes
      </NavLink>

      <div className="flex items-center justify-between gap-3">
        <header className="min-w-0">
          <p className="eyebrow">Class</p>
          <h2 className="text-xl font-semibold text-ink-900 truncate">{klass?.grade_name ?? "Class"}</h2>
        </header>
        <Button size="sm" onClick={() => setEditorOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add subject
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div>
      ) : classSubjects.length === 0 ? (
        <EmptyState
          icon={<Medal className="h-7 w-7" />}
          title="No subjects for this class yet"
          description="Add a subject to start building this class's question bank."
          action={{ label: "Add subject", onClick: () => setEditorOpen(true), icon: <Plus className="h-4 w-4" /> }}
        />
      ) : (
        <div className="space-y-2">
          {classSubjects.map((s) => (
            <SubjectListRow
              key={s.id}
              subject={s}
              classCount={s.grade_level_ids.length}
              to={`/admin/olympiad/classes/${gradeLevelId}/subjects/${s.id}`}
            />
          ))}
        </div>
      )}

      <SubjectEditorSheet open={editorOpen} onOpenChange={setEditorOpen} subject={seedSubject} />
    </div>
  );
}
