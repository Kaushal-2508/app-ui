import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, FileText, Printer, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useInstitutionBranding } from "@/hooks/useInstitutionBranding";
import { toastError } from "@/lib/toast";
import { saveBlob } from "@/lib/native";
import {
  ExamPaperDocument,
  buildExamPaperHtml,
  printExamPaper,
  loadLogoDataUrl,
  fromFetchedExam,
} from "./paper";

interface DownloadQuestionPaperButtonProps {
  examId: string;
  examTitle?: string;
  variant?: "button" | "menuItem" | "icon";
  className?: string;
}

interface ExamRow {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  total_marks: number | null;
  pass_marks: number | null;
  scheduled_date: string | null;
  instructions: string | null;
  exam_mode: "online" | "offline" | null;
  institution_id: string | null;
}

interface SectionRow {
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

export function DownloadQuestionPaperButton({
  examId,
  examTitle,
  variant = "button",
  className,
}: DownloadQuestionPaperButtonProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["exam-question-paper", examId],
    queryFn: async () => {
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

      return { exam: exam as ExamRow, sections: (sections ?? []) as SectionRow[] };
    },
    enabled: dialogOpen,
  });

  const { branding } = useInstitutionBranding(data?.exam.institution_id ?? null);

  const isOffline = data?.exam.exam_mode === "offline";

  const paperData = useMemo(() => {
    if (!data) return null;
    return fromFetchedExam(data.exam, data.sections, branding);
  }, [data, branding]);

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

  const handleDownloadPDF = async () => {
    if (!paperData || !printRef.current) return;
    setIsDownloading(true);
    try {
      const { default: html2pdf } = await import("html2pdf.js");
      const opt = {
        margin: [10, 10, 10, 10],
        filename: `${paperData.meta.title || "Question_Paper"}.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        pagebreak: { mode: ["avoid-all", "css", "legacy"] },
      };
      const blob: Blob = await html2pdf().set(opt).from(printRef.current).outputPdf("blob");
      saveBlob(blob, opt.filename);
    } catch (err) {
      toastError(err, {
        fallback: "Couldn't generate the PDF.",
        context: "downloadQuestionPaper",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!paperData) return;
    const html = buildExamPaperHtml(paperData, {
      logoDataUrl,
      isOffline: !!isOffline,
      showStudentDetailsBox: !!isOffline,
    });
    printExamPaper(html);
  };

  const triggerContent = () => {
    switch (variant) {
      case "icon":
        return (
          <Button
            variant="outline"
            size="icon"
            onClick={() => setDialogOpen(true)}
            className={className}
            title="Download Question Paper"
          >
            <Download className="h-4 w-4" />
          </Button>
        );
      case "menuItem":
        // Styled to match Radix's DropdownMenuItem exactly.
        //
        // This used to be an unstyled <div> that callers wrapped in
        // <DropdownMenuItem asChild>. That never worked: this component returns
        // a FRAGMENT (the row plus its Dialog), and asChild/Slot can only clone
        // a single element — so the menu-item padding, text size, radius and
        // hover state were silently dropped and the row rendered oversized and
        // out of line with its neighbours. It now carries its own styling and is
        // rendered directly inside DropdownMenuContent.
        return (
          <div
            role="menuitem"
            tabIndex={0}
            onClick={() => setDialogOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setDialogOpen(true);
              }
            }}
            className="relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
          >
            <Download className="mr-2 h-4 w-4" />
            Download Paper
          </div>
        );
      default:
        return (
          <Button
            variant="outline"
            onClick={() => setDialogOpen(true)}
            className={className}
          >
            <Download className="h-4 w-4 mr-2" />
            Download Question Paper
          </Button>
        );
    }
  };

  return (
    <>
      {triggerContent()}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Question Paper - {examTitle || paperData?.meta.title || "Loading..."}
            </DialogTitle>
            <DialogDescription>
              Preview and download the question paper
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : paperData ? (
            <>
              <div className="flex gap-3 items-center p-4 bg-muted/50 rounded-lg">
                <Button
                  onClick={handleDownloadPDF}
                  size="lg"
                  className="flex-1"
                  disabled={isDownloading}
                >
                  {isDownloading ? (
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                  ) : (
                    <Download className="h-5 w-5 mr-2" />
                  )}
                  {isDownloading ? "Generating PDF..." : "Download as PDF"}
                </Button>
                <Button variant="outline" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto border rounded-lg max-h-[500px]">
                <ExamPaperDocument
                  ref={printRef}
                  data={paperData}
                  isOffline={!!isOffline}
                  showStudentDetailsBox={!!isOffline}
                />
              </div>
            </>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              Failed to load exam data
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
