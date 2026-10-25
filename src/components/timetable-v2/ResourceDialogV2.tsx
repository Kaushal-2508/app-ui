import { useState } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  useCreateResource,
  type ResourceKind,
} from "@/hooks/useTimetableV2";

const KIND_LABEL: Record<ResourceKind, string> = {
  lab: "Lab",
  library: "Library",
  computer_room: "Computer room",
  sports_facility: "Sports facility",
  other: "Other",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ResourceDialogV2({ open, onOpenChange }: Props) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<ResourceKind>("lab");
  const [capacity, setCapacity] = useState<string>("1");
  const [description, setDescription] = useState("");

  const create = useCreateResource();

  const capNumber = Number(capacity);
  const canSubmit =
    !create.isPending &&
    name.trim().length > 0 &&
    Number.isFinite(capNumber) &&
    capNumber >= 1;

  async function handleSave() {
    await create.mutateAsync({
      name: name.trim(),
      kind,
      capacity: capNumber,
      description: description.trim() ? description.trim() : null,
    });
    setName("");
    setKind("lab");
    setCapacity("1");
    setDescription("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-dirty="true">
        <DialogHeader>
          <DialogTitle>New shared resource</DialogTitle>
          <DialogDescription>
            Rooms, labs, computer rooms, or sports facilities that can be
            booked for specific period slots. Capacity is how many classes
            can use the pool simultaneously.
          </DialogDescription>
        </DialogHeader>

        {/* Wrap body in a <form> so the SW dirty-form check
            (form[data-dirty="true"] in main.tsx) actually matches —
            the attribute on DialogContent's <div> is invisible to
            that selector. */}
        <form
          className="space-y-4 py-2"
          data-dirty="true"
          onSubmit={(e) => e.preventDefault()}
        >
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Physics Lab"
            />
          </div>
          <div className="space-y-2">
            <Label>Kind</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ResourceKind)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as ResourceKind[]).map((k) => (
                  <SelectItem key={k} value={k}>{KIND_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Capacity (parallel bookings)</Label>
            <Input
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Description (optional)</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Equipment, location, seating…"
            />
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave} disabled={!canSubmit}>
            {create.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Add resource
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
