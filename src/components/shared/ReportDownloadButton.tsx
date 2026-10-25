import { useState, RefObject } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, Loader2, FileText, FileSpreadsheet, ChevronDown } from "lucide-react";
import { exportAsTextPdf } from "@/lib/exportTextPdf";
import { toast } from "sonner";

interface ReportDownloadButtonProps {
  documentRef: RefObject<HTMLDivElement>;
  filename?: string;
  title?: string;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  showDropdown?: boolean;
  onExportCSV?: () => void;
  className?: string;
}

export function ReportDownloadButton({
  documentRef,
  filename = "report",
  title = "Download Report",
  variant = "default",
  size = "default",
  showDropdown = false,
  onExportCSV,
  className,
}: ReportDownloadButtonProps) {
  const [isExporting, setIsExporting] = useState(false);

  const handleExportPDF = async () => {
    if (!documentRef.current) {
      toast.error("Unable to generate PDF - content not found");
      return;
    }

    setIsExporting(true);
    toast.info("Opening print dialog for text-based PDF...");

    try {
      const now = new Date();
      const timestamp = now.toISOString().split("T")[0];
      await exportAsTextPdf(documentRef.current, `${filename}_${timestamp}`);
      toast.success("PDF ready! Use 'Save as PDF' in the print dialog.");
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("Failed to generate PDF. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  if (showDropdown && onExportCSV) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={variant} size={size} disabled={isExporting} className={className}>
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                {title}
                <ChevronDown className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={handleExportPDF}>
            <FileText className="h-4 w-4 mr-2" />
            Download as PDF
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportCSV}>
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Download as CSV
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <Button
      variant={variant}
      size={size}
      onClick={handleExportPDF}
      disabled={isExporting}
      className={className}
    >
      {isExporting ? (
        <>
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          Generating...
        </>
      ) : (
        <>
          <Download className="h-4 w-4 mr-2" />
          {title}
        </>
      )}
    </Button>
  );
}

// Print-friendly wrapper for report content
export function PrintableReport({
  children,
  title,
  subtitle,
  generatedAt,
  className,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  generatedAt?: Date;
  className?: string;
}) {
  return (
    <div className={className}>
      {(title || subtitle) && (
        <div className="mb-6 pb-4 border-b print:block">
          {title && <h1 className="text-2xl font-bold">{title}</h1>}
          {subtitle && <p className="text-muted-foreground mt-1">{subtitle}</p>}
          {generatedAt && (
            <p className="text-xs text-muted-foreground mt-2">
              Generated on {generatedAt.toLocaleDateString()} at {generatedAt.toLocaleTimeString()}
            </p>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
