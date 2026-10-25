import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import { usePublishInitiate } from "@/hooks/olympiad/usePublishInitiate";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { useOlympiadBatchesNoPin } from "@/hooks/olympiad/useOlympiadBatchesNoPin";

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  schoolName: string;
  onSuccess?: () => void;
};

type Mode = "school" | "classes" | "batches";

/**
 * Publish results with scope: whole school (final — closes the exam), or a
 * partial class-wise / batch-wise publish. Partial publishes leave the exam
 * open for the remaining batches; each subsequent publish automatically
 * merges — late results upgrade absent rows and all ranks are recomputed.
 */
export function PublishResultsDialog({
  open,
  onOpenChange,
  olySchoolId,
  schoolName,
  onSuccess,
}: Props) {
  const initiate = usePublishInitiate();
  const { data: school } = useOlympiadMySchool();
  const { data: olyClasses = [] } = useOlympiadClasses();
  const { data: batches = [] } = useOlympiadBatchesNoPin(open ? olySchoolId : undefined);

  const [mode, setMode] = useState<Mode>("school");
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [typed, setTyped] = useState("");

  const participatingClasses = useMemo(() => {
    const allowed = new Set(school?.participating_grade_level_ids ?? []);
    return olyClasses
      .filter((c) => allowed.has(c.grade_level_id))
      .map((c) => ({
        gradeLevelId: c.grade_level_id,
        classLabel: c.grade_number != null ? `Class ${c.grade_number}` : c.grade_name,
      }));
  }, [olyClasses, school?.participating_grade_level_ids]);

  const selectableBatches = useMemo(
    () => batches.filter((b) => b.status !== "cancelled" && b.status !== "draft"),
    [batches],
  );

  const batchLabel = (b: (typeof selectableBatches)[number]) =>
    `${b.batch_label} · ${new Date(b.scheduled_at).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    })}`;

  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const scopeChosen =
    mode === "school" ||
    (mode === "classes" && selectedClasses.length > 0) ||
    (mode === "batches" && selectedBatches.length > 0);
  const canConfirm = typed === "PUBLISH" && scopeChosen;

  const reset = () => {
    setTyped("");
    setMode("school");
    setSelectedClasses([]);
    setSelectedBatches([]);
  };

  const onConfirm = async () => {
    try {
      await initiate.mutateAsync({
        oly_school_id: olySchoolId,
        grade_level_ids: mode === "classes" ? selectedClasses : undefined,
        batch_ids: mode === "batches" ? selectedBatches : undefined,
      });
      reset();
      onOpenChange(false);
      onSuccess?.();
    } catch {
      /* toastError handled in mutation */
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Publish results</AlertDialogTitle>
          <AlertDialogDescription>
            Publish results for <strong>{schoolName}</strong>: for the whole school, or only
            for selected classes or batches. Partial publishes keep the exam open for everyone
            else, and later publishes merge automatically (ranks are recomputed across all
            published students).
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="gap-2">
            <label className="flex cursor-pointer items-start gap-2.5">
              <RadioGroupItem value="school" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-ink-900">Whole school (final)</span>
                <span className="block text-xs text-ink-500">
                  Closes the exam permanently. No further attempts or batches. Students with no
                  attempt are marked absent.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <RadioGroupItem value="classes" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-ink-900">Selected classes</span>
                <span className="block text-xs text-ink-500">
                  Publish finished classes now; other classes can still sit their exams.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5">
              <RadioGroupItem value="batches" className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium text-ink-900">Selected batches</span>
                <span className="block text-xs text-ink-500">
                  Publish completed batches now; students scheduled for a later batch keep their
                  chance and merge in when you publish again.
                </span>
              </span>
            </label>
          </RadioGroup>

          {mode === "classes" && (
            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-md border border-surface-stroke p-3">
              {participatingClasses.length === 0 ? (
                <p className="text-xs text-ink-500">No participating classes found.</p>
              ) : (
                participatingClasses.map((c) => (
                  <label key={c.gradeLevelId} className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={selectedClasses.includes(c.gradeLevelId)}
                      onCheckedChange={() => setSelectedClasses((p) => toggle(p, c.gradeLevelId))}
                    />
                    <span className="text-sm text-ink-900">{c.classLabel}</span>
                  </label>
                ))
              )}
            </div>
          )}

          {mode === "batches" && (
            <div className="max-h-36 space-y-1.5 overflow-y-auto rounded-md border border-surface-stroke p-3">
              {selectableBatches.length === 0 ? (
                <p className="text-xs text-ink-500">No locked or completed batches yet.</p>
              ) : (
                selectableBatches.map((b) => (
                  <label key={b.id} className="flex cursor-pointer items-center gap-2.5">
                    <Checkbox
                      checked={selectedBatches.includes(b.id)}
                      onCheckedChange={() => setSelectedBatches((p) => toggle(p, b.id))}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{batchLabel(b)}</span>
                    <span className="shrink-0 rounded-full bg-ink-400/10 px-2 py-0.5 text-[10px] font-medium capitalize text-ink-600">
                      {b.status.replace("_", " ")}
                    </span>
                  </label>
                ))
              )}
            </div>
          )}

          <div className="grid gap-1.5">
            <Label className="text-xs font-medium text-ink-600">Type PUBLISH to confirm</Label>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="PUBLISH"
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={reset}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={!canConfirm || initiate.isPending} onClick={onConfirm}>
            {initiate.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {mode === "school" ? "Publish & Close Exam" : "Publish Selected"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
