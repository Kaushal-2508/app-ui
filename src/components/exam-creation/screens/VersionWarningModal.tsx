import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle } from "lucide-react";

interface VersionWarningModalProps {
  open: boolean;
  currentVersion: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export function VersionWarningModal({
  open,
  currentVersion,
  onConfirm,
  onCancel,
}: VersionWarningModalProps) {
  const nextVersion = currentVersion + 1;
  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#fa920e]/15">
              <AlertTriangle className="h-5 w-5 text-[#fa920e]" />
            </div>
            <Badge variant="outline" className="border-primary/40 text-primary">
              v{nextVersion}
            </Badge>
          </div>
          <DialogTitle>This exam already has student attempts</DialogTitle>
          <DialogDescription>
            Editing the paper will create a new version (v{nextVersion}).
            Previous attempts stay tied to v{currentVersion} so existing results
            don't change.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="min-h-[44px] flex-1"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="min-h-[44px] flex-1"
          >
            Continue editing
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
