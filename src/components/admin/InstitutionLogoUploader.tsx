import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Building2, Upload, X } from "lucide-react";
import {
  useUploadInstitutionLogo,
  useRemoveInstitutionLogo,
  LogoValidationError,
} from "@/hooks/useUploadInstitutionLogo";

interface Props {
  institutionId: string;
  logoUrl: string | null;
  institutionName: string;
  /** When true, render only the thumbnail — no buttons, no validation message. */
  readOnly?: boolean;
}

export function InstitutionLogoUploader({ institutionId, logoUrl, institutionName, readOnly = false }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const upload = useUploadInstitutionLogo();
  const remove = useRemoveInstitutionLogo();

  const initials = institutionName
    .split(" ")
    .map(n => n[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();

  const thumbnail = (
    <div className="h-12 w-12 rounded-xl border bg-muted/50 overflow-hidden flex items-center justify-center flex-shrink-0">
      {logoUrl ? (
        <img src={logoUrl} alt={`${institutionName} logo`} className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs font-semibold text-muted-foreground">
          {initials || <Building2 className="h-5 w-5" />}
        </span>
      )}
    </div>
  );

  if (readOnly) {
    return thumbnail;
  }

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setValidationError(null);
    upload.mutate(
      { institutionId, file },
      {
        onError: (err) => {
          if (err instanceof LogoValidationError) {
            setValidationError(err.message);
          }
        },
      },
    );
  };

  const isPending = upload.isPending || remove.isPending;

  return (
    <div className="flex items-center gap-3">
      {thumbnail}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={isPending}
          >
            <Upload className="h-3.5 w-3.5 mr-1.5" />
            {logoUrl ? "Replace" : "Upload"}
          </Button>
          {logoUrl && (
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => remove.mutate({ institutionId })}
              disabled={isPending}
            >
              <X className="h-3.5 w-3.5 mr-1.5" />
              Remove
            </Button>
          )}
        </div>
        {validationError ? (
          <p className="text-xs text-destructive">{validationError}</p>
        ) : (
          <p className="text-xs text-muted-foreground">PNG/JPG/WebP, ≤ 2 MB, square ≥ 256×256.</p>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
