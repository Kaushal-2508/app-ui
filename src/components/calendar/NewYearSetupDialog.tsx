import { useEffect, useMemo, useState } from "react";
import { Sparkles, Copy, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { useQueryClient } from "@tanstack/react-query";

// -------------------------------------------------------------
// NewYearSetupDialog
//
// Admin-only dialog shown when a fresh academic year is about
// to be used. Offers two paths:
//   - "Start fresh"  → no action (new year just stays empty)
//   - "Copy from Y"  → invokes the `copy-timetable-template`
//                       edge function to clone every timetable
//                       slot from the picked source year.
// lesson_plans are NEVER copied; they stay empty every year.
// -------------------------------------------------------------

interface NewYearSetupDialogProps {
  open: boolean;
  onClose: () => void;
  /** The year we're setting up (target). */
  targetYear: string;
  /** Years available as copy sources (exclude target). */
  candidateSourceYears: string[];
  /** Default source (usually previous year). */
  defaultSourceYear?: string;
  /** Called after a successful copy OR an explicit "fresh" choice. */
  onCompleted: (mode: "fresh" | "copy", stats?: { copied: number; skipped: number }) => void;
}

type Mode = "fresh" | "copy";

export function NewYearSetupDialog({
  open,
  onClose,
  targetYear,
  candidateSourceYears,
  defaultSourceYear,
  onCompleted,
}: NewYearSetupDialogProps) {
  const { institutionId } = useEffectiveInstitution();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("copy");
  const [sourceYear, setSourceYear] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const sortedSources = useMemo(
    () =>
      candidateSourceYears
        .filter((y) => y !== targetYear)
        .sort()
        .reverse(),
    [candidateSourceYears, targetYear],
  );

  // Pick a sane default: explicit prop > most recent available > empty
  useEffect(() => {
    if (!open) return;
    if (defaultSourceYear && sortedSources.includes(defaultSourceYear)) {
      setSourceYear(defaultSourceYear);
    } else if (sortedSources.length > 0) {
      setSourceYear(sortedSources[0]);
    } else {
      setSourceYear("");
      setMode("fresh");
    }
  }, [open, defaultSourceYear, sortedSources]);

  const canConfirm =
    !submitting &&
    (mode === "fresh" || (mode === "copy" && !!sourceYear));

  const handleConfirm = async () => {
    if (!institutionId) return;

    if (mode === "fresh") {
      onCompleted("fresh");
      onClose();
      return;
    }

    if (!sourceYear) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "copy-timetable-template",
        {
          body: {
            institution_id: institutionId,
            source_academic_year: sourceYear,
            target_academic_year: targetYear,
          },
        },
      );
      if (error) throw error;

      const copied = (data as { copied?: number })?.copied ?? 0;
      const skipped = (data as { skipped?: number })?.skipped ?? 0;

      toast.success(
        copied === 0
          ? `No new slots copied (target year already has matching slots).`
          : `Copied ${copied} slot${copied === 1 ? "" : "s"} into ${targetYear}`,
      );

      queryClient.invalidateQueries({ queryKey: ["timetable-slots"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-teacher-load"] });

      onCompleted("copy", { copied, skipped });
      onClose();
    } catch (e) {
      toastError(e as Error, {
        fallback: "Couldn't copy the timetable.",
        context: "copyTimetableTemplate",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !submitting && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Set up timetable for {targetYear}</DialogTitle>
          <DialogDescription>
            How would you like to start this academic year? You can always
            edit slots later.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={mode}
          onValueChange={(v) => setMode(v as Mode)}
          className="gap-3"
        >
          <label
            htmlFor="mode-copy"
            className={`flex gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
              mode === "copy"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/30"
            } ${sortedSources.length === 0 ? "opacity-50 pointer-events-none" : ""}`}
          >
            <RadioGroupItem
              id="mode-copy"
              value="copy"
              disabled={sortedSources.length === 0}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <Copy className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">
                  Copy from an earlier year
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Clone every class's weekly template (subjects, teachers, and
                rooms) into {targetYear}. Lesson plans stay empty so teachers
                can plan fresh.
              </p>
              {mode === "copy" && sortedSources.length > 0 && (
                <div className="pt-2">
                  <Label className="text-xs">Source year</Label>
                  <Select
                    value={sourceYear}
                    onValueChange={setSourceYear}
                    disabled={submitting}
                  >
                    <SelectTrigger className="mt-1 h-9">
                      <SelectValue placeholder="Pick a year" />
                    </SelectTrigger>
                    <SelectContent>
                      {sortedSources.map((y) => (
                        <SelectItem key={y} value={y}>
                          {y}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          </label>

          <label
            htmlFor="mode-fresh"
            className={`flex gap-3 rounded-lg border p-4 cursor-pointer transition-colors ${
              mode === "fresh"
                ? "border-primary bg-primary/5"
                : "hover:bg-muted/30"
            }`}
          >
            <RadioGroupItem id="mode-fresh" value="fresh" className="mt-1" />
            <div className="flex-1 space-y-1.5">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="font-semibold text-sm">Start fresh</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Every class starts with an empty grid for {targetYear}. Build
                the timetable from scratch in the Timetable page.
              </p>
            </div>
          </label>
        </RadioGroup>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Decide later
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {mode === "fresh" ? "Start fresh" : `Copy from ${sourceYear || "…"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
