import { Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGenerateCredentialsPdf } from "@/hooks/olympiad/useGenerateCredentialsPdf";
import { toastError } from "@/lib/toast";
import { openExternal } from "@/lib/native";

type Props = { olySchoolId: string; gradeLevelId: string };

export function PrintCredentialsButton({ olySchoolId, gradeLevelId }: Props) {
  const gen = useGenerateCredentialsPdf();
  const onClick = async () => {
    try {
      const result = await gen.mutateAsync({ oly_school_id: olySchoolId, grade_level_id: gradeLevelId });
      if (result.signed_url) {
        openExternal(result.signed_url);
      }
    } catch (err) {
      toastError(err as Error, { fallback: "Couldn't open credentials PDF.", context: "PrintCredentialsButton" });
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={onClick} disabled={gen.isPending}>
      {gen.isPending ? (
        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
      ) : (
        <Printer className="h-4 w-4 mr-1" />
      )}
      Print credentials
    </Button>
  );
}
