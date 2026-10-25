import { useState } from "react";
import { Download, Loader2, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/native";
import { useOlympiadStudyMaterialUrl } from "@/hooks/olympiad/useOlympiadStudyMaterialUrl";

type Props = {
  material: { id: string; title: string; description: string | null; file_size_bytes: number };
};

export function StudyMaterialItem({ material }: Props) {
  const get = useOlympiadStudyMaterialUrl();
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await get.mutateAsync(material.id);
      openExternal(url);
    } catch {
      // toastError fires in the mutation's onError; the catch keeps the rejected
      // mutateAsync from surfacing as a global "unexpected error" toast.
    } finally {
      setBusy(false);
    }
  };

  const sizeMb = (material.file_size_bytes / (1024 * 1024)).toFixed(2);

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      aria-label={`Open ${material.title}`}
      className={cn(
        "surface-card frosted-shadow rounded-card flex w-full items-center gap-3 px-4 py-3 text-left",
        "transition-[box-shadow,transform,border-color] duration-200",
        "hover:-translate-y-px hover:shadow-md hover:border-brand-primary/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40",
        "disabled:cursor-wait disabled:opacity-70",
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
        <FileText className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink-900">{material.title}</span>
        <span className="block truncate text-[11px] text-ink-500">
          {sizeMb} MB{material.description ? ` · ${material.description}` : ""}
        </span>
      </span>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink-400">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      </span>
    </button>
  );
}
