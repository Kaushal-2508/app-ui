import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Download,
  FileText,
  CheckCircle2,
  Printer,
  Send,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import type { ExamFormData, ExamStats } from "@/types/exam";
import { useInstitutionBranding } from "@/hooks/useInstitutionBranding";
import { toastError } from "@/lib/toast";
import { saveBlob } from "@/lib/native";
import {
  ExamPaperDocument,
  buildExamPaperHtml,
  printExamPaper,
  loadLogoDataUrl,
  fromExamFormData,
} from "./paper";

interface OfflinePublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: ExamFormData;
  stats: ExamStats;
  onPublish: () => void;
  isPublishing: boolean;
}

export function OfflinePublishDialog({
  open,
  onOpenChange,
  formData,
  stats,
  onPublish,
  isPublishing,
}: OfflinePublishDialogProps) {
  const [hasDownloaded, setHasDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const { branding } = useInstitutionBranding(formData.context?.institutionId ?? null);

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

  const handleDownloadPDF = async () => {
    if (!printRef.current) return;
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
      setHasDownloaded(true);
    } catch (err) {
      toastError(err, {
        fallback: "Couldn't generate the PDF.",
        context: "offlinePublishDownload",
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handlePrint = () => {
    const html = buildExamPaperHtml(paperData, {
      logoDataUrl,
      isOffline: true,
      showStudentDetailsBox: true,
    });
    printExamPaper(html);
    setHasDownloaded(true);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Offline Exam - Download Question Paper
          </DialogTitle>
          <DialogDescription>
            Download the question paper before publishing the exam
          </DialogDescription>
        </DialogHeader>

        <Alert className="border-amber-200 bg-amber-50 dark:bg-amber-950/20">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-700 dark:text-amber-300">
            <strong>Offline Exam:</strong> Please download and print the question paper before publishing.
            Students will write answers on physical answer sheets.
          </AlertDescription>
        </Alert>

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
          {hasDownloaded && (
            <Badge variant="default" className="bg-green-600">
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Downloaded
            </Badge>
          )}
        </div>

        <div className="flex-1 overflow-y-auto border rounded-lg max-h-[400px]">
          <ExamPaperDocument
            ref={printRef}
            data={paperData}
            isOffline
            showStudentDetailsBox
          />
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPublishing}>
            Cancel
          </Button>
          <Button
            onClick={onPublish}
            disabled={isPublishing}
            className="bg-green-600 hover:bg-green-700"
          >
            {isPublishing ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Publishing...
              </>
            ) : (
              <>
                <Send className="h-4 w-4 mr-2" />
                {hasDownloaded ? "Publish Exam" : "Skip Download & Publish"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
