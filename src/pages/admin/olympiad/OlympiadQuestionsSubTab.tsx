import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { Loader2, Plus, Upload, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";
import { QuestionBankTable } from "@/components/olympiad/admin/QuestionBankTable";
import { QuestionEditorSheet } from "@/components/olympiad/admin/QuestionEditorSheet";
import { QuestionCsvImportSheet } from "@/components/olympiad/admin/QuestionCsvImportSheet";
import { QuestionAiGenerateSheet } from "@/components/olympiad/admin/QuestionAiGenerateSheet";

type Ctx = { subject: OlympiadSubject; gradeLevelId?: string };

type GradeLevel = {
  id: string;
  grade_name: string;
  grade_number: number;
  display_order: number;
};

function useGradeLevelMap() {
  return useQuery<GradeLevel[]>({
    queryKey: ["grade-levels", "map"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, grade_number, display_order")
        .eq("is_active", true)
        .order("display_order");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export default function OlympiadQuestionsSubTab() {
  const { subject, gradeLevelId } = useOutletContext<Ctx>();
  const { data: grades, isLoading } = useGradeLevelMap();
  const applicable = (grades ?? []).filter((g) =>
    gradeLevelId ? g.id === gradeLevelId : subject.grade_level_ids.includes(g.id),
  );

  const [addOpen, setAddOpen] = useState<{ gradeId: string } | null>(null);
  const [csvOpen, setCsvOpen] = useState<{ gradeId: string } | null>(null);
  const [aiOpen, setAiOpen] = useState<{ gradeId: string } | null>(null);

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
    <Accordion type="multiple" defaultValue={[applicable[0]?.id]}>
      {applicable.map((g) => (
        <AccordionItem key={g.id} value={g.id}>
          <AccordionTrigger className="text-sm">{g.grade_name}</AccordionTrigger>
          <AccordionContent>
            <div className="flex flex-wrap justify-end gap-2 mb-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCsvOpen({ gradeId: g.id })}
              >
                <Upload className="h-4 w-4 mr-1" />
                CSV import
              </Button>
              <Button
                size="sm"
                className="bg-brand-accent text-white hover:bg-brand-accent/90"
                onClick={() => setAiOpen({ gradeId: g.id })}
              >
                <Sparkles className="h-4 w-4 mr-1" />
                AI generate
              </Button>
              <Button
                size="sm"
                onClick={() => setAddOpen({ gradeId: g.id })}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add question
              </Button>
            </div>
            <QuestionBankTable subjectId={subject.id} gradeLevelId={g.id} />

            <QuestionEditorSheet
              open={addOpen?.gradeId === g.id}
              onOpenChange={(o) => !o && setAddOpen(null)}
              subjectId={subject.id}
              gradeLevelId={g.id}
              initial={null}
            />
            <QuestionCsvImportSheet
              open={csvOpen?.gradeId === g.id}
              onOpenChange={(o) => !o && setCsvOpen(null)}
              subjectId={subject.id}
              gradeLevelId={g.id}
            />
            <QuestionAiGenerateSheet
              open={aiOpen?.gradeId === g.id}
              onOpenChange={(o) => !o && setAiOpen(null)}
              subjectId={subject.id}
              gradeLevelId={g.id}
            />
          </AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
