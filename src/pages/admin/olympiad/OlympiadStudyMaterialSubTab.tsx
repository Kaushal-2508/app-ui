import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Loader2, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadStudyMaterials } from "@/hooks/olympiad/useOlympiadStudyMaterials";
import { StudyMaterialListRow } from "@/components/olympiad/admin/StudyMaterialListRow";
import { StudyMaterialUploadSheet } from "@/components/olympiad/admin/StudyMaterialUploadSheet";

type Ctx = { subject: OlympiadSubject; gradeLevelId?: string };

type GradeLevel = {
  id: string;
  grade_name: string;
  grade_number: number | null;
  display_order: number;
};

function useGradeLevelMap() {
  return useQuery({
    queryKey: ["grade-levels", "map"],
    queryFn: async (): Promise<GradeLevel[]> => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as GradeLevel[];
    },
    staleTime: 5 * 60_000,
  });
}

function MaterialsForGrade({
  subjectId,
  gradeLevelId,
}: {
  subjectId: string;
  gradeLevelId: string;
}) {
  const { data: materials, isLoading } = useOlympiadStudyMaterials(subjectId, gradeLevelId);
  const [open, setOpen] = useState(false);

  return (
    <div className="space-y-2">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Upload material
        </Button>
      </div>
      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      ) : (materials ?? []).length === 0 ? (
        <p className="text-sm text-ink-500 py-4 text-center">
          No materials uploaded for this class yet.
        </p>
      ) : (
        <div className="space-y-2">
          {(materials ?? []).map((m) => (
            <StudyMaterialListRow key={m.id} material={m} />
          ))}
        </div>
      )}
      <StudyMaterialUploadSheet
        open={open}
        onOpenChange={setOpen}
        subjectId={subjectId}
        gradeLevelId={gradeLevelId}
      />
    </div>
  );
}

export default function OlympiadStudyMaterialSubTab() {
  const { subject, gradeLevelId } = useOutletContext<Ctx>();
  const { data: grades, isLoading } = useGradeLevelMap();
  const applicable = (grades ?? []).filter((g) =>
    gradeLevelId ? g.id === gradeLevelId : subject.grade_level_ids.includes(g.id),
  );

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  if (applicable.length === 0) {
    return (
      <p className="text-sm text-ink-600 py-6 text-center">
        Edit the subject to choose at least one applicable class first.
      </p>
    );
  }

  return (
    <Accordion type="multiple" defaultValue={[applicable[0].id]}>
      {applicable.map((g) => (
        <AccordionItem key={g.id} value={g.id}>
          <AccordionTrigger className="text-sm">{g.grade_name}</AccordionTrigger>
          <AccordionContent>
            <MaterialsForGrade subjectId={subject.id} gradeLevelId={g.id} />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
