import { useState } from "react";
import { CapturedSheet } from "@/hooks/useOfflineScan";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { X, CheckCircle2, ZoomIn } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetPreviewGridProps {
  sheets: CapturedSheet[];
  onRemove: (sheetId: string) => void;
  showMatchStatus?: boolean;
}

export function SheetPreviewGrid({
  sheets,
  onRemove,
  showMatchStatus = false,
}: SheetPreviewGridProps) {
  const [enlargedSheet, setEnlargedSheet] = useState<CapturedSheet | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {sheets.map((sheet, index) => (
          <div
            key={sheet.id}
            className={cn(
              "relative group rounded-lg border overflow-hidden bg-muted aspect-[3/4]",
              showMatchStatus && sheet.studentId && "ring-2 ring-green-500"
            )}
          >
            {/* Sheet number badge */}
            <Badge
              variant="secondary"
              className="absolute top-2 left-2 z-10 text-xs"
            >
              {index + 1}
            </Badge>

            {/* Match status */}
            {showMatchStatus && sheet.studentId && (
              <div className="absolute top-2 right-8 z-10">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
              </div>
            )}

            {/* Remove button */}
            <Button
              variant="destructive"
              size="icon"
              className="absolute top-2 right-2 z-10 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => onRemove(sheet.id)}
            >
              <X className="h-3 w-3" />
            </Button>

            {/* Preview image */}
            <div
              className="w-full h-full cursor-pointer"
              onClick={() => setEnlargedSheet(sheet)}
            >
              {sheet.file.type === "application/pdf" ? (
                <div className="w-full h-full flex items-center justify-center">
                  <div className="text-center">
                    <span className="text-2xl">📄</span>
                    <p className="text-xs text-muted-foreground mt-1 px-2 truncate">
                      {sheet.file.name}
                    </p>
                  </div>
                </div>
              ) : (
                <img
                  src={sheet.previewUrl}
                  alt={`Sheet ${index + 1}`}
                  className="w-full h-full object-cover"
                />
              )}
            </div>

            {/* Zoom overlay on hover */}
            <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
              <ZoomIn className="h-6 w-6 text-white" />
            </div>

            {/* Student name if matched */}
            {showMatchStatus && sheet.studentName && (
              <div className="absolute bottom-0 left-0 right-0 bg-black/70 text-white text-xs p-1 truncate text-center">
                {sheet.studentName}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Enlarged view dialog */}
      <Dialog open={!!enlargedSheet} onOpenChange={() => setEnlargedSheet(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-2">
          {enlargedSheet && (
            <div className="relative">
              {enlargedSheet.file.type === "application/pdf" ? (
                <div className="flex items-center justify-center h-[60vh]">
                  <div className="text-center">
                    <span className="text-6xl">📄</span>
                    <p className="text-lg mt-4">{enlargedSheet.file.name}</p>
                    <p className="text-sm text-muted-foreground mt-2">
                      PDF preview not available
                    </p>
                  </div>
                </div>
              ) : (
                <img
                  src={enlargedSheet.previewUrl}
                  alt="Enlarged sheet"
                  className="w-full h-auto max-h-[80vh] object-contain"
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
