import { useRef, useState } from "react";
import { Camera, Loader2, Paperclip, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { CameraCapture } from "@/components/offline-scan/CameraCapture";
import { HOMEWORK_FILE_ACCEPT } from "@/lib/fileValidation";

export type AttachmentStage = "compressing" | "uploading" | null;

interface HomeworkAttachmentFieldProps {
  /** The stored attachment's display name; null renders the pickers. */
  attachmentName: string | null;
  /** What the flow is doing with the last pick, for the button label. */
  stage: AttachmentStage;
  /** True while the whole form is saving, so nothing here may change. */
  disabled: boolean;
  error: string | null;
  /** A file from the gallery, a document, or a photo just taken. */
  onPick: (file: File) => void;
  onClear: () => void;
}

/**
 * The teacher's single attachment on a homework: a photo taken right here, a
 * file from the device, or the chip for the one already stored.
 *
 * "Take photo" reuses the app's camera (the same component behind attendance,
 * profile photos and the hybrid answer-sheet scan), which the shell already has
 * permissions for on both platforms. The flow compresses photos before upload;
 * this component only picks them. The accept list adds HEIC on top of the
 * shared homework accept string because the flow converts HEIC to JPEG, which
 * the bucket allowlist does accept; the student submission input keeps the
 * plain list because that path does no conversion.
 */
export function HomeworkAttachmentField({
  attachmentName,
  stage,
  disabled,
  error,
  onPick,
  onClear,
}: HomeworkAttachmentFieldProps) {
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const busy = stage !== null;

  const handleCapture = (file: File) => {
    setShowCamera(false);
    onPick(file);
  };

  return (
    <section className="surface-card frosted-shadow rounded-card p-4 sm:p-6 space-y-3">
      <div>
        <Label>Attachment (optional)</Label>
        <p className="mt-0.5 text-[13px] text-ink-500">
          Photo, PDF or Office document, up to 10 MB. Photos are compressed on your device first.
        </p>
      </div>

      {attachmentName ? (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2.5">
          <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
            <Paperclip className="h-4 w-4 shrink-0 text-brand-primary" />
            <span className="truncate">{attachmentName}</span>
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            disabled={disabled}
            aria-label="Remove attachment"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : showCamera ? (
        <CameraCapture
          onCapture={handleCapture}
          onClose={() => setShowCamera(false)}
          facingMode="environment"
          filePrefix="homework"
        />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
          <Button
            type="button"
            onClick={() => setShowCamera(true)}
            disabled={busy || disabled}
            className="bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            <Camera className="mr-2 h-4 w-4" />
            Take photo
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => fileRef.current?.click()}
            disabled={busy || disabled}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Paperclip className="mr-2 h-4 w-4" />}
            {stage === "compressing" ? "Compressing" : stage === "uploading" ? "Uploading" : "Add file"}
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept={`${HOMEWORK_FILE_ACCEPT},.heic,.heif`}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so picking the same file again still fires onChange.
              e.target.value = "";
              if (file) onPick(file);
            }}
          />
        </div>
      )}

      {error && <p className="text-[13px] text-rose-600">{error}</p>}
    </section>
  );
}
