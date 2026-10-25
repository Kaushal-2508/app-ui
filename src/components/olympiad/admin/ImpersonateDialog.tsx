import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useImpersonateSchoolAdmin } from "@/hooks/olympiad/useImpersonateSchoolAdmin";
import { openExternal } from "@/lib/native";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  schoolName: string;
};

export function ImpersonateDialog({ open, onOpenChange, olySchoolId, schoolName }: Props) {
  const impersonate = useImpersonateSchoolAdmin();
  const [reason, setReason] = useState("");

  // Supabase auth stores the session in localStorage per-origin, so opening the magic link
  // in a regular tab overwrites this super-admin session. The user must open it in an
  // incognito window to keep both sessions alive.
  const handleOpenChange = (o: boolean) => {
    if (!o) setReason("");
    onOpenChange(o);
  };

  const onConfirm = async () => {
    if (!reason.trim()) return;
    try {
      const result = await impersonate.mutateAsync({ oly_school_id: olySchoolId, reason: reason.trim() });
      openExternal(result.magic_link);
      handleOpenChange(false);
    } catch {
      // toastError fires on error path
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Impersonate school admin?</AlertDialogTitle>
          <AlertDialogDescription>
            This generates a 5-minute magic link that signs you in as{" "}
            <strong>{schoolName}</strong>&apos;s school admin in a new tab. The action is audit-logged.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Project has no --warning token yet (CLAUDE.md §20a admits the design system is mid-build);
            fall back to amber-50/300 with dark-mode variants, matching the existing ImpersonationBanner. */}
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-ink-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" />
          <span>
            Open the magic link in an <strong>incognito window</strong>. Opening it in a normal tab
            replaces your super-admin session in this browser.
          </span>
        </div>

        <div className="grid gap-1.5 py-2">
          <Label className="text-xs font-medium text-ink-600">Reason (required)</Label>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="e.g. Support request from school"
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={!reason.trim() || impersonate.isPending}
            onClick={onConfirm}
          >
            {impersonate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Generate impersonation link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
