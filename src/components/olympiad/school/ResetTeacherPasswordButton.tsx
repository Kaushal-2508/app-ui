import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { OlympiadTeacherCredentials } from "@/components/olympiad/school/OlympiadTeacherCredentials";
import {
  useResetOlympiadTeacherPassword,
  type ResetOlympiadTeacherPasswordResult,
} from "@/hooks/olympiad/useResetOlympiadTeacherPassword";

type Props = {
  olySchoolId: string;
  teacherProfileId: string;
  teacherName: string;
};

export function ResetTeacherPasswordButton({
  olySchoolId,
  teacherProfileId,
  teacherName,
}: Props) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ResetOlympiadTeacherPasswordResult | null>(null);
  const reset = useResetOlympiadTeacherPassword();

  useEffect(() => {
    if (!open) setResult(null);
  }, [open]);

  const onGenerate = async () => {
    try {
      const res = await reset.mutateAsync({
        oly_school_id: olySchoolId,
        teacher_profile_id: teacherProfileId,
      });
      setResult(res);
    } catch {
      // toastError fires via the hook's onError
    }
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="shrink-0"
        onClick={() => setOpen(true)}
      >
        <KeyRound className="mr-1 h-3.5 w-3.5" /> New password
      </Button>

      <MobileSheet
        open={open}
        onOpenChange={setOpen}
        title={result ? "New password" : "Reset password"}
        subtitle={
          result
            ? "Share the new login details with the teacher"
            : `Generate a new password for ${teacherName || "this teacher"}`
        }
        icon={<KeyRound className="h-4 w-4" />}
        primaryAction={
          result
            ? { label: "Done", onClick: () => setOpen(false) }
            : {
                label: "Generate new password",
                onClick: () => void onGenerate(),
                loading: reset.isPending,
              }
        }
        secondaryAction={{
          label: result ? "Close" : "Cancel",
          onClick: () => setOpen(false),
        }}
      >
        {result ? (
          <OlympiadTeacherCredentials
            name={teacherName}
            email={result.email}
            password={result.temp_password}
            intro="New password generated. The old password no longer works. Share the updated details below."
          />
        ) : (
          <p className="text-sm text-ink-600">
            This replaces the teacher's current password with a new one. Their existing password
            stops working immediately. You'll see the new password once and can copy it to share.
          </p>
        )}
      </MobileSheet>
    </>
  );
}
