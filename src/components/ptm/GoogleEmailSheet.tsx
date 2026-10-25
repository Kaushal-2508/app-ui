import { useEffect, useRef, useState } from "react";
import { Loader2, Video } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MobileSheet } from "@/components/shared/sheets";
import { isPlausibleEmail, useGoogleEmail, useSetGoogleEmail } from "@/hooks/ptm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** "you" when `self`, else the teacher's name, for the copy. */
  displayName: string;
  self: boolean;
}

/**
 * Set or remove the Google account a teacher joins Meet with (rooms are open
 * to anyone with the link; there is no co-host, status note item 18). One
 * field; the server stores it lowercased and checks the shape, nothing more:
 * it cannot tell a Google account from any other address, so the copy says
 * what to enter. The stored value is read through get_google_email, the
 * only way the browser may see it.
 */
export function GoogleEmailSheet({ open, onOpenChange, userId, displayName, self }: Props) {
  const stored = useGoogleEmail(userId, self, open);
  const current = stored.data ?? null;
  const [value, setValue] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const save = useSetGoogleEmail();

  // Seed from the stored value when the sheet opens and once it has loaded,
  // not on every refetch while it is up.
  const seeded = useRef(false);
  useEffect(() => {
    if (!open) {
      seeded.current = false;
      return;
    }
    if (seeded.current || stored.isLoading) return;
    seeded.current = true;
    setValue(current ?? "");
  }, [open, stored.isLoading, current]);

  const trimmed = value.trim().toLowerCase();
  const valid = isPlausibleEmail(trimmed);
  const unchanged = trimmed === (current ?? "").toLowerCase();
  const pending = save.isPending;

  const submit = () => {
    if (!valid || unchanged || pending) return;
    save.mutate({ userId, email: trimmed, self }, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <>
      <MobileSheet
        open={open}
        onOpenChange={(next) => !pending && onOpenChange(next)}
        title={current ? "Change Google account" : "Add Google account"}
        subtitle={self ? "For your online PTMs" : `For ${displayName}'s online PTMs`}
        icon={<Video className="h-5 w-5" />}
        desktopWidth="md"
        primaryAction={{
          label: "Save",
          onClick: submit,
          loading: pending,
          disabled: !valid || unchanged || pending || stored.isLoading,
        }}
        secondaryAction={
          current
            ? { label: "Remove", onClick: () => setConfirmRemove(true), disabled: pending }
            : { label: "Cancel", onClick: () => onOpenChange(false), disabled: pending }
        }
      >
        <form
          className="space-y-3 p-4"
          data-dirty={trimmed && !unchanged ? "true" : undefined}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="google-email">Google account email</Label>
            <Input
              id="google-email"
              type="email"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={stored.isLoading ? "Loading…" : "name@gmail.com"}
              maxLength={254}
            />
            {stored.isError && (
              <p className="text-sm text-rose-600 dark:text-rose-400">
                Couldn't load the stored account; saving will still replace it.
              </p>
            )}
            {trimmed.length > 0 && !valid && (
              <p className="text-sm text-rose-600 dark:text-rose-400">That doesn't look like an email address.</p>
            )}
          </div>
          <p className="text-xs leading-relaxed text-ink-500">
            {self
              ? "Use the Google account you will join Meet with (Gmail or Google Workspace). It is only shown so families know who to expect; rooms open to anyone with the link."
              : `Use the Google account ${displayName} joins Meet with (Gmail or Google Workspace). It is only shown so families know who to expect; rooms open to anyone with the link.`}
          </p>
        </form>
      </MobileSheet>

      <AlertDialog open={confirmRemove} onOpenChange={(next) => !pending && setConfirmRemove(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the Google account?</AlertDialogTitle>
            <AlertDialogDescription>
              Meeting rooms can't be made for {self ? "your" : `${displayName}'s`} online PTM slots until a new
              one is set.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={(e) => {
                e.preventDefault();
                save.mutate(
                  { userId, email: null, self },
                  {
                    onSuccess: () => {
                      setConfirmRemove(false);
                      onOpenChange(false);
                    },
                  },
                );
              }}
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
