import { useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { toastError } from "@/lib/toast";
import { openExternal } from "@/lib/native";
import {
  getStudyMaterialSignedUrl,
  useDeleteStudyMaterial,
  type StudyMaterial,
} from "@/hooks/olympiad/useOlympiadStudyMaterials";

export function StudyMaterialListRow({ material }: { material: StudyMaterial }) {
  const del = useDeleteStudyMaterial();
  const [busy, setBusy] = useState(false);

  const onDownload = async () => {
    setBusy(true);
    try {
      const url = await getStudyMaterialSignedUrl(material.storage_path);
      openExternal(url);
    } catch (e) {
      toastError(e as Error, {
        fallback: "Couldn't open material.",
        context: "StudyMaterialListRow.onDownload",
      });
    } finally {
      setBusy(false);
    }
  };

  const sizeMb = (material.file_size_bytes / (1024 * 1024)).toFixed(2);

  return (
    <div className="flex items-center gap-3 px-3 py-2.5 surface-card frosted-shadow rounded-card">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink-900 truncate">{material.title}</p>
        <p className="text-[11px] text-ink-500">
          Order {material.display_order} · {sizeMb} MB
          {material.description ? ` · ${material.description}` : ""}
        </p>
      </div>
      <Button size="icon" variant="ghost" onClick={onDownload} disabled={busy}>
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </Button>
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="icon" variant="ghost" disabled={del.isPending}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this material?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the file and metadata. Students will lose access
              immediately.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                del.mutate({ id: material.id, storagePath: material.storage_path })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
