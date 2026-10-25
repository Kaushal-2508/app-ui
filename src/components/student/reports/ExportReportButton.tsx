import { useState, RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2 } from "lucide-react";
import { exportAsTextPdf } from "@/lib/exportTextPdf";
import { toast } from "sonner";

interface ExportReportButtonProps {
  documentRef: RefObject<HTMLDivElement>;
  filename?: string;
  buttonText?: string;
  variant?: "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
  size?: "default" | "sm" | "lg" | "icon";
}

export function ExportReportButton({
  documentRef,
  filename = "student_report.pdf",
  buttonText = "Download PDF",
  variant = "outline",
  size = "sm",
}: ExportReportButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!documentRef.current) {
      toast.error("Unable to generate PDF - content not found");
      return;
    }

    setIsExporting(true);
    toast.info("Opening print dialog for text-based PDF...");

    try {
      await exportAsTextPdf(documentRef.current, filename.replace('.pdf', ''));
      toast.success("PDF ready! Use 'Save as PDF' in the print dialog.");
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Failed to generate PDF. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleExport}
      disabled={isExporting}
    >
      {isExporting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Generating...
        </>
      ) : (
        <>
          <Download className="h-4 w-4 mr-2" />
          {buttonText}
        </>
      )}
    </Button>
  );
}
