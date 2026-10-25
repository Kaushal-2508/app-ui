import { saveBlob } from "@/lib/native";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize2,
  Download,
  X,
} from "lucide-react";

interface AnswerImageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string;
  fileName?: string;
  questionNumber?: number;
  ocrConfidence?: number;
}

export function AnswerImageModal({
  open,
  onOpenChange,
  imageUrl,
  fileName,
  questionNumber,
  ocrConfidence,
}: AnswerImageModalProps) {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  const handleZoomIn = () => setZoom((prev) => Math.min(prev + 0.25, 3));
  const handleZoomOut = () => setZoom((prev) => Math.max(prev - 0.25, 0.5));
  const handleRotate = () => setRotation((prev) => (prev + 90) % 360);
  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  const handleDownload = async () => {
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      saveBlob(blob, fileName || "answer-sheet.jpg");
    } catch (error) {
      console.error("Download failed:", error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] max-h-[90vh] p-0">
        <DialogHeader className="p-4 border-b flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <DialogTitle>
              {questionNumber ? `Question ${questionNumber}` : "Answer Sheet"}
            </DialogTitle>
            {ocrConfidence !== undefined && (
              <Badge
                variant={ocrConfidence >= 0.8 ? "default" : "secondary"}
                className={ocrConfidence >= 0.8 ? "bg-green-600" : ""}
              >
                OCR: {Math.round(ocrConfidence * 100)}%
              </Badge>
            )}
            {fileName && (
              <span className="text-sm text-muted-foreground">{fileName}</span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={handleZoomOut} title="Zoom out">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm w-12 text-center">{Math.round(zoom * 100)}%</span>
            <Button variant="ghost" size="icon" onClick={handleZoomIn} title="Zoom in">
              <ZoomIn className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRotate} title="Rotate">
              <RotateCw className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleReset} title="Reset">
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleDownload} title="Download">
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="overflow-auto flex-1 p-4 bg-muted/30" style={{ maxHeight: "calc(90vh - 80px)" }}>
          <div className="flex items-center justify-center min-h-[400px]">
            <img
              src={imageUrl}
              alt="Answer sheet"
              style={{
                transform: `scale(${zoom}) rotate(${rotation}deg)`,
                transformOrigin: "center center",
                transition: "transform 0.2s ease",
                maxWidth: "100%",
                height: "auto",
              }}
              className="shadow-lg rounded"
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
