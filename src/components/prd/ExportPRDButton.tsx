import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FileDown, Loader2, Eye } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import PRDDocument from "./PRDDocument";
import { exportAsTextPdf } from "@/lib/exportTextPdf";

interface ExportPRDButtonProps {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
}

export default function ExportPRDButton({ variant = "default", size = "default" }: ExportPRDButtonProps) {
  const [open, setOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);

  const handleExport = async () => {
    if (!documentRef.current) return;

    setIsExporting(true);
    try {
      await exportAsTextPdf(documentRef.current, "SALCI_PRD_v2.8");
    } catch (error) {
      console.error("PDF export failed:", error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <FileDown className="h-4 w-4 mr-2" />
        Export PRD as PDF
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              PRD Preview
            </DialogTitle>
            <DialogDescription>
              Preview the PRD document before exporting to PDF
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 mb-4">
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating PDF...
                </>
              ) : (
                <>
                  <FileDown className="h-4 w-4 mr-2" />
                  Download PDF
                </>
              )}
            </Button>
          </div>

          <ScrollArea className="flex-1 border rounded-lg">
            <PRDDocument ref={documentRef} />
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
