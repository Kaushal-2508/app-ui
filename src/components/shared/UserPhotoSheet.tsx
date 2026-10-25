import { useRef, useState } from "react";
import { Camera, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { CameraCapture } from "@/components/offline-scan/CameraCapture";
import { useClearUserAvatar, useSetUserAvatar } from "@/hooks/useSetUserAvatar";

export interface UserPhotoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetId: string;
  targetName?: string | null;
  targetEmail?: string | null;
  institutionId?: string | null;
  currentPath?: string | null;
}

/**
 * placement="center" is required, not cosmetic: MobileSheet's bottom placement
 * is hardcoded bg-white and does not flip in dark mode (a documented
 * pre-existing bug shared by 20+ consumers).
 */
export function UserPhotoSheet({
  open,
  onOpenChange,
  targetId,
  targetName,
  targetEmail,
  institutionId,
  currentPath,
}: UserPhotoSheetProps) {
  const [showCamera, setShowCamera] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const setAvatar = useSetUserAvatar();
  const clearAvatar = useClearUserAvatar();
  const busy = setAvatar.isPending || clearAvatar.isPending;

  const handleFile = (file: File) => {
    // Single-flight: a second file while the first upload is still running would
    // race two set_user_avatar calls and orphan whichever object lost.
    if (busy) return;
    setShowCamera(false);
    setAvatar.mutate(
      { targetId, targetName, institutionId, file },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // so picking the same file again still fires
    if (file) handleFile(file);
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Profile photo"
      subtitle={targetName ?? undefined}
      placement="center"
    >
      <div className="flex flex-col gap-6 py-2">
        {showCamera ? (
          <CameraCapture
            onCapture={handleFile}
            onClose={() => setShowCamera(false)}
            facingMode="user"
            filePrefix="avatar"
          />
        ) : (
          <>
            <div className="flex justify-center">
              <UserAvatar
                name={targetName}
                email={targetEmail}
                avatarPath={currentPath}
                className="h-24 w-24"
                fallbackClassName="text-2xl"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Button
                type="button"
                className="h-16"
                disabled={busy}
                onClick={() => setShowCamera(true)}
              >
                <Camera className="mr-2 h-5 w-5" />
                Take photo
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-16"
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="mr-2 h-5 w-5" />
                Upload image
              </Button>
            </div>

            {currentPath ? (
              <Button
                type="button"
                variant="ghost"
                className="text-destructive"
                disabled={busy}
                onClick={() =>
                  clearAvatar.mutate(
                    { targetId, targetName, institutionId },
                    { onSuccess: () => onOpenChange(false) },
                  )
                }
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove photo
              </Button>
            ) : null}

            <p className="text-center text-xs text-ink-500">
              JPG, PNG, WebP or HEIC, up to 10 MB. The picture is cropped to a square.
            </p>
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={handleInput}
        />
      </div>
    </MobileSheet>
  );
}