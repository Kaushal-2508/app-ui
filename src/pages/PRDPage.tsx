import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileDown, Loader2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import PRDDocument from "@/components/prd/PRDDocument";
import { exportAsTextPdf } from "@/lib/exportTextPdf";

export default function PRDPage() {
  const [isExporting, setIsExporting] = useState(false);
  const documentRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

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
    <div className="min-h-dvh bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">SALCI PRD</h1>
              <p className="text-sm text-muted-foreground">Product Requirements Document</p>
            </div>
          </div>
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
      </div>

      {/* Document Preview */}
      <div className="container mx-auto px-4 py-8">
        <Card className="overflow-hidden">
          <ScrollArea className="h-[calc(100dvh-180px)]">
            <PRDDocument ref={documentRef} />
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}
