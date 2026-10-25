import { Eye, Loader2, Paperclip, Upload, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ADMISSION_DOC_ACCEPT } from "@/lib/admissions";

export interface ChecklistRow {
  doc_key: string;
  label: string;
}

export interface ChecklistFile {
  name: string;
}

/**
 * The certificates collected at admission (Naman, 2026-10-09: "receptionist
 * has tick and select option that which certificates has been collected";
 * 2026-10-12: "an option to upload the documents as well"). One row per
 * document of the school's list; `value` holds the ticked keys; with the
 * upload handlers each row also takes a photo or a PDF of the certificate,
 * shows it, replaces it or removes it.
 */
export function DocumentChecklist({
  items,
  value,
  onChange,
  disabled = false,
  dense = false,
  files,
  onUpload,
  onOpen,
  onRemoveFile,
  busyKey = null,
}: {
  items: ChecklistRow[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  /** Two columns from sm up, for a record that has the room. */
  dense?: boolean;
  /** The uploaded scan per document key, when the caller supports uploads. */
  files?: Record<string, ChecklistFile | null | undefined>;
  onUpload?: (docKey: string, file: File) => void;
  onOpen?: (docKey: string) => void;
  onRemoveFile?: (docKey: string) => void;
  /** The document whose upload or removal is in flight. */
  busyKey?: string | null;
}) {
  const ticked = new Set(value);
  const toggle = (key: string) => {
    onChange(ticked.has(key) ? value.filter((k) => k !== key) : [...value, key]);
  };
  const canUpload = !!onUpload;
  const pick = (key: string) => {
    const input = document.getElementById(`doc-file-${key}`) as HTMLInputElement | null;
    input?.click();
  };
  if (items.length === 0) {
    return <p className="text-sm text-ink-500">No certificates are listed. Add them in Admissions settings.</p>;
  }
  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-500" aria-live="polite">
        {value.length} of {items.length} collected
      </p>
      <ul
        className={cn(
          dense
            ? "grid gap-x-6 sm:grid-cols-2 lg:grid-cols-3 [&>li]:border-b [&>li]:border-surface-stroke"
            : "divide-y divide-surface-stroke overflow-hidden rounded-xl border border-surface-stroke",
        )}
        data-document-checklist=""
      >
        {items.map((d) => {
          const on = ticked.has(d.doc_key);
          const file = files?.[d.doc_key] ?? null;
          const busy = busyKey === d.doc_key;
          const inputId = `doc-file-${d.doc_key}`;
          const boxId = `doc-tick-${d.doc_key}`;
          return (
            <li key={d.doc_key} className={cn("flex items-center py-2 text-sm", dense ? "gap-2" : "gap-3 px-3", on ? "text-ink-900" : "text-ink-700")} data-doc-row={d.doc_key}>
              <Checkbox id={boxId} checked={on} disabled={disabled} onCheckedChange={() => toggle(d.doc_key)} aria-label={d.label} />
              <label
                htmlFor={boxId}
                className={cn("min-w-0 flex-1 py-0.5", dense ? "break-words leading-snug" : "truncate", disabled ? "cursor-default" : "cursor-pointer")}
                title={file ? `${d.label}: ${file.name}` : d.label}
              >
                {d.label}
                {file && (
                  <span className="ml-1.5 inline-flex items-center text-emerald-700 dark:text-emerald-300" aria-label="Scan uploaded">
                    <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                )}
              </label>
              {!on && !canUpload && !dense && <span className="shrink-0 text-xs text-ink-500">Pending</span>}
              {canUpload && (
                <span className="flex shrink-0 items-center gap-0.5">
                  <input
                    id={inputId}
                    type="file"
                    accept={ADMISSION_DOC_ACCEPT}
                    className="sr-only"
                    tabIndex={-1}
                    aria-label={`Upload ${d.label}`}
                    disabled={disabled || busy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = "";
                      if (f) onUpload?.(d.doc_key, f);
                    }}
                  />
                  {busy ? (
                    <Loader2 className="mx-2 h-4 w-4 animate-spin text-ink-500" aria-label="Working" />
                  ) : file ? (
                    <>
                      <Button type="button" variant="ghost" size="sm" className={cn("h-7 text-xs", dense ? "w-7 px-0" : "px-2")} onClick={() => onOpen?.(d.doc_key)}>
                        <Eye className={cn("h-3.5 w-3.5", !dense && "sm:mr-1")} aria-hidden="true" />
                        <span className={cn("sr-only", !dense && "sm:not-sr-only")}>View</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-ink-500"
                        aria-label={`Replace the scan of ${d.label}`}
                        disabled={disabled}
                        onClick={() => pick(d.doc_key)}
                      >
                        <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                      {onRemoveFile && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-ink-500"
                          aria-label={`Remove the scan of ${d.label}`}
                          disabled={disabled}
                          onClick={() => onRemoveFile(d.doc_key)}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <Button type="button" variant="ghost" size="sm" className={cn("h-7 text-xs text-ink-600", dense ? "w-7 px-0" : "px-2")} disabled={disabled} onClick={() => pick(d.doc_key)}>
                      <Upload className={cn("h-3.5 w-3.5", !dense && "sm:mr-1")} aria-hidden="true" />
                      <span className={cn("sr-only", !dense && "sm:not-sr-only")}>Upload</span>
                    </Button>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {canUpload && <p className="text-xs text-ink-500">A photo or a PDF per certificate, up to 10 MB. Uploading one ticks it as collected.</p>}
    </div>
  );
}
