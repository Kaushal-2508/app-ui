import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, FileText, Printer } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { translateError } from "@/lib/errorMessages";
import { useInstitutionBranding } from "@/hooks/useInstitutionBranding";
import {
  ExamPaperDocument,
  buildExamPaperHtml,
  printExamPaper,
  loadLogoDataUrl,
  fromFetchedExam,
} from "./paper";

interface ExamPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  examId: string | null;
  examTitle?: string;
  examMode?: "online" | "offline";
}

interface ExamPreviewRow {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  pass_marks: number | null;
  scheduled_date: string | null;
  instructions: string | null;
  exam_mode: "online" | "offline";
  institution_id: string | null;
}

interface ExamSectionRow {
  id: string;
  title: string;
  section_type: string | null;
  instructions: string | null;
  section_order: number;
  exam_questions: {
    id: string;
    question_text: string;
    question_type: string;
    marks: number;
    options: unknown;
    question_order: number;
    parent_question_id: string | null;
    image_url: string | null;
  }[];
}

export function ExamPreviewDialog({
  open,
  onOpenChange,
  examId,
  examTitle,
  examMode = "online",
}: ExamPreviewDialogProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["exam-preview", examId],
    queryFn: async () => {
      if (!examId) return null;
      const { data: exam, error: examError } = await supabase
        .from("exams")
        .select(
          "id, title, description, duration_minutes, total_marks, pass_marks, scheduled_date, instructions, exam_mode, institution_id",
        )
        .eq("id", examId)
        .single();
      if (examError) throw examError;

      const { data: sections, error: sectionsError } = await supabase
        .from("exam_sections")
        .select(
          `id, title, section_type, instructions, section_order,
           exam_questions(id, question_text, question_type, marks, options, question_order, parent_question_id, image_url)`,
        )
        .eq("exam_id", examId)
        .order("section_order");
      if (sectionsError) throw sectionsError;

      return {
        exam: exam as ExamPreviewRow,
        sections: (sections ?? []) as ExamSectionRow[],
      };
    },
    enabled: open && !!examId,
  });

  const { branding } = useInstitutionBranding(data?.exam.institution_id ?? null);

  const paperData = useMemo(() => {
    if (!data) return null;
    return fromFetchedExam(data.exam, data.sections, branding);
  }, [data, branding]);

  const isOffline = (data?.exam.exam_mode ?? examMode) === "offline";

  // Pre-load logo as data URL so the print popup renders without auth headers.
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadLogoDataUrl(branding?.logoUrl ?? null).then(url => {
      if (!cancelled) setLogoDataUrl(url);
    });
    return () => {
      cancelled = true;
    };
  }, [branding?.logoUrl]);

  const handlePrint = () => {
    if (!paperData) return;
    const html = buildExamPaperHtml(paperData, {
      logoDataUrl,
      isOffline,
      showStudentDetailsBox: isOffline,
    });
    printExamPaper(html);
  };

  const headingTitle = data?.exam.title ?? examTitle ?? "Exam preview";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <Eye className="h-4 w-4 shrink-0 text-brand-primary" />
            <span className="truncate">{headingTitle}</span>
          </DialogTitle>
          <DialogDescription>
            {isOffline
              ? "Preview the printable question paper. Use Print to send it to your printer."
              : "Preview the question paper as students will see it."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-3 py-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            <div className="font-medium">
              {translateError(error, "Couldn't load this exam.").title}
            </div>
            {translateError(error, "Couldn't load this exam.").description && (
              <p className="mt-1 text-xs text-destructive/80">
                {translateError(error, "Couldn't load this exam.").description}
              </p>
            )}
          </div>
        ) : !paperData ? (
          <div className="rounded-md border border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
            No exam selected.
          </div>
        ) : paperData.sections.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border bg-muted/20 px-4 py-10 text-center">
            <FileText className="h-6 w-6 text-muted-foreground" />
            <div className="text-sm font-medium text-foreground">No questions yet</div>
            <p className="text-xs text-muted-foreground">
              Add questions to this exam to see a preview.
            </p>
          </div>
        ) : (
          <div className="rounded-md border border-border overflow-hidden">
            <ExamPaperDocument
              data={paperData}
              isOffline={isOffline}
              showStudentDetailsBox={isOffline}
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {paperData && paperData.sections.length > 0 && (
            <Button
              type="button"
              variant="outline"
              onClick={handlePrint}
              className="gap-1.5"
            >
              <Printer className="h-4 w-4" />
              Print
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
