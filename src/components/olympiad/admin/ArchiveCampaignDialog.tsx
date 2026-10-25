import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useArchiveCampaign } from "@/hooks/olympiad/useArchiveCampaign";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  schoolName: string;
};

export function ArchiveCampaignDialog({ open, onOpenChange, olySchoolId, schoolName }: Props) {
  const archive = useArchiveCampaign();
  const [typed, setTyped] = useState("");
  const canConfirm = typed === "ARCHIVE";

  const handleOpenChange = (o: boolean) => {
    if (!o) setTyped("");
    onOpenChange(o);
  };

  const onConfirm = async () => {
    if (!canConfirm) return;
    try {
      await archive.mutateAsync({ oly_school_id: olySchoolId });
      handleOpenChange(false);
    } catch {
      // toastError fires on error path
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Archive {schoolName}&apos;s enrollment?</AlertDialogTitle>
          <AlertDialogDescription>
            This archives only {schoolName}&apos;s Olympiad enrollment for the current campaign. Other
            schools are unaffected. Existing results, certificates, and PDFs are preserved. The school
            disappears from the active list.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Type ARCHIVE to confirm</Label>
          <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirm || archive.isPending} onClick={onConfirm}>
            {archive.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Archive
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
