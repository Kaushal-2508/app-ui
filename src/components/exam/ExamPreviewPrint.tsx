import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Printer, Eye, FileText } from "lucide-react";
import type { ExamFormData, ExamStats } from "@/types/exam";
import { useInstitutionBranding } from "@/hooks/useInstitutionBranding";
import {
  ExamPaperDocument,
  buildExamPaperHtml,
  printExamPaper,
  loadLogoDataUrl,
  fromExamFormData,
} from "./paper";

interface ExamPreviewPrintProps {
  formData: ExamFormData;
  stats: ExamStats;
}

export function ExamPreviewPrint({ formData, stats }: ExamPreviewPrintProps) {
  const [previewOpen, setPreviewOpen] = useState(false);

  const { branding } = useInstitutionBranding(formData.context?.institutionId ?? null);

  const isOffline = formData.metadata.examMode === "offline";

  const paperData = useMemo(
    () => fromExamFormData(formData, stats, branding),
    [formData, stats, branding],
  );

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
    const html = buildExamPaperHtml(paperData, {
      logoDataUrl,
      isOffline,
      showStudentDetailsBox: isOffline,
    });
    printExamPaper(html);
  };

  return (
    <div className="flex gap-2">
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Eye className="h-4 w-4 mr-2" />
            Preview Paper
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Exam Paper Preview
            </DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 mb-4 no-print">
            <Button onClick={handlePrint} size="sm">
              <Printer className="h-4 w-4 mr-2" />
              Print
            </Button>
          </div>

          <div className="border rounded-lg overflow-hidden">
            <ExamPaperDocument
              data={paperData}
              isOffline={isOffline}
              showStudentDetailsBox={isOffline}
            />
          </div>
        </DialogContent>
      </Dialog>

      <Button variant="outline" size="sm" onClick={handlePrint}>
        <Printer className="h-4 w-4 mr-2" />
        Print
      </Button>
    </div>
  );
}
