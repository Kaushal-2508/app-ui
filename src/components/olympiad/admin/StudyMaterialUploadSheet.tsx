import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useUploadStudyMaterial } from "@/hooks/olympiad/useOlympiadStudyMaterials";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
};

function parseIntOr(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function StudyMaterialUploadSheet({
  open,
  onOpenChange,
  subjectId,
  gradeLevelId,
}: Props) {
  const upload = useUploadStudyMaterial();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setDisplayOrder(0);
      setFile(null);
    }
  }, [open]);

  const isDirty = !!(title || description || file || displayOrder !== 0);

  const onSubmit = async () => {
    if (!file) return;
    try {
      await upload.mutateAsync({
        subjectId,
        gradeLevelId,
        title: title.trim(),
        description: description.trim() || null,
        displayOrder,
        file,
      });
      onOpenChange(false);
    } catch {
      // onError surfaces toast; keep sheet open
    }
  };

  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} title="Upload study material">
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Description</Label>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Display order</Label>
            <Input
              type="number"
              value={displayOrder}
              onChange={(e) => setDisplayOrder(parseIntOr(e.target.value, displayOrder))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">PDF (max 10 MB)</Label>
            <Input
              type="file"
              accept="application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={!title.trim() || !file || upload.isPending}>
            {upload.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Upload
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
