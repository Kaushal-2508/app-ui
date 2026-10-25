import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { MobileSheet } from "@/components/shared/sheets";
import { toast } from "sonner";
import type { ResultVisibility } from "@/types/exam";

export interface ResultSetupValues {
  totalMarks: number;
  scheduledDate: Date;
  passPercent: number | null;
  resultVisibility: ResultVisibility;
}

interface ResultSetupSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onConfirm: (values: ResultSetupValues) => void;
}

const VIS_OPTIONS: { v: ResultVisibility; t: string }[] = [
  { v: "immediate", t: "Immediately" },
  { v: "after_teacher_releases", t: "After teacher releases" },
  { v: "hidden", t: "Hidden from students" },
];

/** Collects total marks + date + pass% + visibility before inline marks entry. */
export function ResultSetupSheet({ open, onOpenChange, isSaving, onConfirm }: ResultSetupSheetProps) {
  const [totalMarks, setTotalMarks] = useState("");
  const [dateStr, setDateStr] = useState(new Date().toISOString().slice(0, 10));
  const [passPercent, setPassPercent] = useState("33");
  const [visibility, setVisibility] = useState<ResultVisibility>("after_teacher_releases");

  const handleConfirm = () => {
    const total = Number(totalMarks);
    if (!Number.isFinite(total) || total <= 0) {
      toast.error("Enter the total marks (greater than 0)");
      return;
    }
    if (!dateStr) {
      toast.error("Pick the date the exam was conducted");
      return;
    }
    const pctRaw = passPercent.trim();
    const pct = pctRaw === "" ? null : Number(pctRaw);
    if (pct != null && (!Number.isFinite(pct) || pct < 0 || pct > 100)) {
      toast.error("Pass % must be between 0 and 100");
      return;
    }
    onConfirm({
      totalMarks: total,
      scheduledDate: new Date(dateStr),
      passPercent: pct != null && Number.isFinite(pct) ? pct : null,
      resultVisibility: visibility,
    });
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      icon={<CalendarClock className="h-4 w-4" />}
      title="Set up results"
      primaryAction={{
        label: "Continue to marks",
        onClick: handleConfirm,
        loading: isSaving,
        disabled: isSaving,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false), disabled: isSaving }}
    >
      <div className="space-y-4">
        <div>
          <Label className="mb-1 block">Total marks</Label>
          <Input
            type="number"
            min={1}
            className="min-h-[44px]"
            value={totalMarks}
            onChange={(e) => setTotalMarks(e.target.value)}
            placeholder="e.g. 100"
          />
        </div>
        <div>
          <Label className="mb-1 block">Date conducted</Label>
          <Input
            type="date"
            className="min-h-[44px]"
            value={dateStr}
            onChange={(e) => setDateStr(e.target.value)}
          />
        </div>
        <div>
          <Label className="mb-1 block">Pass %</Label>
          <div className="relative">
            <Input
              type="number"
              min={0}
              max={100}
              className="min-h-[44px] pr-10"
              value={passPercent}
              onChange={(e) => setPassPercent(e.target.value)}
              placeholder="optional"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div>
          <Label className="mb-2 block">Who sees results</Label>
          <RadioGroup
            value={visibility}
            onValueChange={(v) => setVisibility(v as ResultVisibility)}
            className="space-y-2"
          >
            {VIS_OPTIONS.map((o) => (
              <label
                key={o.v}
                htmlFor={`rsv-${o.v}`}
                className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 hover:border-primary/40"
              >
                <RadioGroupItem id={`rsv-${o.v}`} value={o.v} />
                <span className="text-sm font-medium">{o.t}</span>
              </label>
            ))}
          </RadioGroup>
        </div>
      </div>
    </MobileSheet>
  );
}
