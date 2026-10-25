import { useRef, useState } from "react";
import { Upload, FileText, Image as ImageIcon, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { uploadExamPaperFile } from "@/lib/examPaperStorage";
import type { SourcePaperFile } from "@/types/exam";

interface UploadPaperPanelProps {
  institutionId: string;
  files: SourcePaperFile[];
  onChange: (files: SourcePaperFile[]) => void;
}

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";
const MAX_BYTES = 52 * 1024 * 1024;

/** Optional multi-file paper uploader shown in place of the sections builder. */
export function UploadPaperPanel({ institutionId, files, onChange }: UploadPaperPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    if (!institutionId) {
      toast.error("Institution not resolved yet. Try again in a moment.");
      return;
    }
    setUploading(true);
    // Declared outside the try so a mid-batch failure still commits the files
    // that already uploaded — otherwise those objects become orphans in the
    // public bucket (no form-state/DB reference, not removable via the UI).
    const accepted: SourcePaperFile[] = [];
    try {
      for (const f of Array.from(list)) {
        if (f.size > MAX_BYTES) {
          toast.error(`${f.name} is larger than 52 MB`);
          continue;
        }
        accepted.push(await uploadExamPaperFile(f, institutionId));
      }
    } catch (err) {
      toastError(err, { fallback: "Couldn't upload the file.", context: "uploadExamPaper" });
    } finally {
      if (accepted.length) onChange([...files, ...accepted]);
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removeAt = (idx: number) => onChange(files.filter((_, i) => i !== idx));

  return (
    <section className="space-y-3 flex-1 md:rounded-xl md:border md:border-border md:bg-card md:p-6 md:shadow-sm">
      <div className="text-sm font-semibold text-foreground md:text-base">
        Upload exam paper <span className="text-muted-foreground font-normal">(optional)</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Attach photos or a PDF of the question paper. You can skip this and still continue.
      </p>

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="group/add w-full rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] hover:bg-primary/[0.07] hover:border-primary/50 transition-all duration-200 p-6 flex flex-col items-center justify-center gap-2 min-h-[120px] disabled:opacity-60"
      >
        {uploading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : (
          <Upload className="h-6 w-6 text-primary" />
        )}
        <div className="text-sm font-semibold text-primary">
          {uploading ? "Uploading…" : "Tap to upload"}
        </div>
        <div className="text-[11px] text-muted-foreground">Images or PDF · up to 52 MB each</div>
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((f, i) => (
            <li
              key={f.path}
              className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2"
            >
              {f.mime === "application/pdf" ? (
                <FileText className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ImageIcon className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="flex-1 truncate text-sm">{f.name}</span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                className="text-muted-foreground hover:text-destructive"
                aria-label={`Remove ${f.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
