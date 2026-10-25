import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import {
  RESOURCE_TYPES,
  RESOURCE_TYPE_LABELS,
  type SharedResourceInput,
  type ResourceType,
} from "@/hooks/useSharedResources";

interface SharedResourceFormProps {
  initial?: SharedResourceInput | null;
  onSubmit: (input: SharedResourceInput) => void | Promise<void>;
  onCancel?: () => void;
  isSubmitting?: boolean;
  submitLabel?: string;
}

const EMPTY: SharedResourceInput = {
  name: "",
  resource_type: "lab",
  count: 1,
  description: "",
};

export function SharedResourceForm({
  initial,
  onSubmit,
  onCancel,
  isSubmitting,
  submitLabel = "Save resource",
}: SharedResourceFormProps) {
  const [form, setForm] = useState<SharedResourceInput>(initial ?? EMPTY);

  useEffect(() => {
    setForm(initial ?? EMPTY);
  }, [initial]);

  const canSubmit =
    form.name.trim().length > 0 && form.count >= 1 && !isSubmitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    await onSubmit({
      name: form.name.trim(),
      resource_type: form.resource_type,
      count: form.count,
      description: form.description?.trim() || null,
    });
  };

  return (
    <div className="space-y-4">
      {/* Name takes the full row; Type and How many share the next one, so
          the grid never leaves an empty cell (it used to, inside a dialog). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="resource-name">Name</Label>
          <Input
            id="resource-name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="e.g. Science Lab"
            disabled={isSubmitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="resource-type">Type</Label>
          <Select
            value={form.resource_type}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, resource_type: v as ResourceType }))
            }
            disabled={isSubmitting}
          >
            <SelectTrigger id="resource-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RESOURCE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {RESOURCE_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="resource-count">How many</Label>
          <Input
            id="resource-count"
            type="number"
            min={1}
            value={form.count}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                count: Math.max(1, Number(e.target.value) || 1),
              }))
            }
            disabled={isSubmitting}
          />
          <p className="text-xs text-muted-foreground">
            Separate rooms of the same kind (e.g. 2 science labs).
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="resource-description">Description (optional)</Label>
        <Textarea
          id="resource-description"
          value={form.description ?? ""}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          placeholder="Anything the timetable builder should know"
          rows={2}
          disabled={isSubmitting}
        />
      </div>

      <div className="flex justify-end gap-2 border-t border-surface-stroke pt-4">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        )}
        <Button type="button" onClick={handleSubmit} disabled={!canSubmit}>
          {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
