import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CapturedSheet } from "@/hooks/useOfflineScan";
import { SheetPreviewGrid } from "./SheetPreviewGrid";
import { CameraCapture } from "./CameraCapture";
import { Camera, Image, Upload, ArrowLeft, ArrowRight, AlertCircle } from "lucide-react";
import { toast } from "sonner";

interface CaptureStepProps {
  sheets: CapturedSheet[];
  onAddSheet: (file: File) => CapturedSheet;
  onAddSheets: (files: File[]) => CapturedSheet[];
  onRemoveSheet: (sheetId: string) => void;
  onBack: () => void;
  onNext: () => void;
}

export function CaptureStep({
  sheets,
  onAddSheet,
  onAddSheets,
  onRemoveSheet,
  onBack,
  onNext,
}: CaptureStepProps) {
  const [activeTab, setActiveTab] = useState<"camera" | "gallery" | "files">("camera");
  const [showCamera, setShowCamera] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const handleGallerySelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const imageFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
      if (imageFiles.length === 0) {
        toast.error("Please select image files only");
        return;
      }

      onAddSheets(imageFiles);
      toast.success(`Added ${imageFiles.length} sheet(s)`);

      // Reset input
      if (galleryInputRef.current) {
        galleryInputRef.current.value = "";
      }
    },
    [onAddSheets]
  );

  const handleFilesSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files) return;

      const validFiles = Array.from(files).filter(
        (f) => f.type.startsWith("image/") || f.type === "application/pdf"
      );
      if (validFiles.length === 0) {
        toast.error("Please select image or PDF files only");
        return;
      }

      onAddSheets(validFiles);
      toast.success(`Added ${validFiles.length} file(s)`);

      // Reset input
      if (filesInputRef.current) {
        filesInputRef.current.value = "";
      }
    },
    [onAddSheets]
  );

  const handleCameraCapture = useCallback(
    (file: File) => {
      onAddSheet(file);
      toast.success("Photo captured!");
      setShowCamera(false);
    },
    [onAddSheet]
  );

  const canProceed = sheets.length > 0;

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="camera" className="gap-2">
            <Camera className="h-4 w-4" />
            Camera
          </TabsTrigger>
          <TabsTrigger value="gallery" className="gap-2">
            <Image className="h-4 w-4" />
            Gallery
          </TabsTrigger>
          <TabsTrigger value="files" className="gap-2">
            <Upload className="h-4 w-4" />
            Files
          </TabsTrigger>
        </TabsList>

        <TabsContent value="camera" className="mt-4">
          {showCamera ? (
            <CameraCapture
              onCapture={handleCameraCapture}
              onClose={() => setShowCamera(false)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed rounded-lg">
              <Camera className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground mb-4">
                Take photos of answer sheets using your device camera
              </p>
              <Button onClick={() => setShowCamera(true)}>
                <Camera className="mr-2 h-4 w-4" />
                Open Camera
              </Button>
            </div>
          )}
        </TabsContent>

        <TabsContent value="gallery" className="mt-4">
          <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed rounded-lg">
            <Image className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Select existing photos from your device gallery
            </p>
            <Button onClick={() => galleryInputRef.current?.click()}>
              <Image className="mr-2 h-4 w-4" />
              Select from Gallery
            </Button>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleGallerySelect}
            />
          </div>
        </TabsContent>

        <TabsContent value="files" className="mt-4">
          <div className="flex flex-col items-center justify-center py-8 border-2 border-dashed rounded-lg">
            <Upload className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-4">
              Upload multiple images or PDF files at once
            </p>
            <Button onClick={() => filesInputRef.current?.click()}>
              <Upload className="mr-2 h-4 w-4" />
              Browse Files
            </Button>
            <input
              ref={filesInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={handleFilesSelect}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Supports: JPG, PNG, PDF
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Captured Sheets Preview */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            Captured Sheets ({sheets.length})
          </h3>
          {sheets.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (activeTab === "camera") setShowCamera(true);
                else if (activeTab === "gallery") galleryInputRef.current?.click();
                else filesInputRef.current?.click();
              }}
            >
              Add More
            </Button>
          )}
        </div>

        {sheets.length === 0 ? (
          <div className="flex items-center gap-2 p-4 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            <p className="text-sm">
              No sheets captured yet. Use the tabs above to add answer sheets.
            </p>
          </div>
        ) : (
          <SheetPreviewGrid sheets={sheets} onRemove={onRemoveSheet} />
        )}
      </div>

      {/* Navigation */}
      <div className="flex justify-between pt-4 border-t">
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          Next: Match Students
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
