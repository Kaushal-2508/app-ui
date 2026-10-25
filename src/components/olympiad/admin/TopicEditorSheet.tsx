import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import {
  useUpsertOlympiadTopic,
  type OlympiadTopic,
} from "@/hooks/olympiad/useOlympiadTopics";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  subjectId: string;
  gradeLevelId: string;
  topic?: OlympiadTopic | null;
};

export function TopicEditorSheet({
  open,
  onOpenChange,
  subjectId,
  gradeLevelId,
  topic,
}: Props) {
  const upsert = useUpsertOlympiadTopic();
  const [name, setName] = useState("");
  const [displayOrder, setDisplayOrder] = useState(0);
  const [status, setStatus] = useState<"active" | "archived">("active");
  const initialRef = useRef<{
    name: string;
    displayOrder: number;
    status: "active" | "archived";
  }>({ name: "", displayOrder: 0, status: "active" });

  useEffect(() => {
    if (topic) {
      setName(topic.name);
      setDisplayOrder(topic.display_order);
      setStatus(topic.status);
      initialRef.current = {
        name: topic.name,
        displayOrder: topic.display_order,
        status: topic.status,
      };
    } else {
      setName("");
      setDisplayOrder(0);
      setStatus("active");
      initialRef.current = { name: "", displayOrder: 0, status: "active" };
    }
  }, [topic, open]);

  const isDirty =
    name.trim() !== initialRef.current.name.trim() ||
    displayOrder !== initialRef.current.displayOrder ||
    status !== initialRef.current.status;

  const parseIntOr = (raw: string, fallback: number): number => {
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : fallback;
  };

  const onSubmit = async () => {
    try {
      await upsert.mutateAsync({
        id: topic?.id,
        subject_id: subjectId,
        grade_level_id: gradeLevelId,
        name: name.trim(),
        display_order: displayOrder,
        status,
      });
      onOpenChange(false);
    } catch {
      // onError on the mutation already surfaces toastError.
      // Keep the sheet open so the user can correct and retry.
    }
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title={topic ? "Edit topic" : "New topic"}
    >
      <form
        data-dirty={isDirty ? "true" : "false"}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="space-y-4"
      >
        <div className="grid gap-1.5">
          <Label className="text-xs font-medium text-ink-600">Topic name</Label>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">
              Display order
            </Label>
            <Input
              type="number"
              value={displayOrder}
              onChange={(e) =>
                setDisplayOrder(parseIntOr(e.target.value, displayOrder))
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Status</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as "active" | "archived")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!name.trim() || upsert.isPending}
          >
            {upsert.isPending && (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            )}
            Save
          </Button>
        </div>
      </form>
    </MobileSheet>
  );
}
