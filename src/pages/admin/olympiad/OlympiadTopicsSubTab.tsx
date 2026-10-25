import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { BookOpen, Loader2, Pencil, Plus } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import {
  useOlympiadTopics,
  type OlympiadTopic,
} from "@/hooks/olympiad/useOlympiadTopics";
import { TopicEditorSheet } from "@/components/olympiad/admin/TopicEditorSheet";
import { supabase } from "@/integrations/supabase/client";
import { type OlympiadSubject } from "@/hooks/olympiad/useOlympiadSubjects";

type Ctx = { subject: OlympiadSubject; gradeLevelId?: string };

type GradeLevel = {
  id: string;
  grade_name: string;
  grade_number: number;
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
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

type SheetState = {
  open: boolean;
  gradeLevelId: string;
  topic: OlympiadTopic | null;
};

export default function OlympiadTopicsSubTab() {
  const { subject, gradeLevelId } = useOutletContext<Ctx>();
  const { data: topics, isLoading } = useOlympiadTopics(subject.id);
  const { data: grades } = useGradeLevelMap();
  const applicable = (grades ?? []).filter((g) =>
    gradeLevelId ? g.id === gradeLevelId : subject.grade_level_ids.includes(g.id),
  );

  const [sheetState, setSheetState] = useState<SheetState>({
    open: false,
    gradeLevelId: "",
    topic: null,
  });

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
      </div>
    );
  }

  if (applicable.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-7 w-7" />}
        title="No applicable classes"
        description="Edit the subject to choose at least one applicable class first."
      />
    );
  }

  return (
    <>
      <Accordion
        type="multiple"
        defaultValue={applicable.map((g) => g.id)}
      >
        {applicable.map((g) => {
          const byGrade = (topics ?? []).filter(
            (t) => t.grade_level_id === g.id,
          );
          return (
            <AccordionItem key={g.id} value={g.id}>
              <AccordionTrigger className="text-sm">
                <span className="flex-1 text-left">{g.grade_name}</span>
                <span className="text-xs text-ink-500 mr-2">
                  {byGrade.length} topic{byGrade.length === 1 ? "" : "s"}
                </span>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {byGrade.map((t) => (
                    <div
                      key={t.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-md bg-surface-card"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink-900 truncate">
                          {t.name}
                        </p>
                        <p className="text-[11px] text-ink-500">
                          Order {t.display_order} · {t.status}
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() =>
                          setSheetState({
                            open: true,
                            gradeLevelId: g.id,
                            topic: t,
                          })
                        }
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setSheetState({
                        open: true,
                        gradeLevelId: g.id,
                        topic: null,
                      })
                    }
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add topic
                  </Button>
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      <TopicEditorSheet
        open={sheetState.open}
        onOpenChange={(o) => setSheetState((s) => ({ ...s, open: o }))}
        subjectId={subject.id}
        gradeLevelId={sheetState.gradeLevelId}
        topic={sheetState.topic}
      />
    </>
  );
}
