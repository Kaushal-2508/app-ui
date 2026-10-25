import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { ArrowLeft, Loader2, Monitor } from "lucide-react";
import { toast } from "sonner";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useUpdateOlympiadLabs } from "@/hooks/olympiad/useUpdateOlympiadLabs";

const MAX_LABS = 20;

const clampCount = (raw: string, max: number): number | "" => {
  if (raw === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  return Math.max(0, Math.min(max, Math.floor(n)));
};

/**
 * Labs & PCs — launched from Resource Planning. Asks for the number of labs
 * first; with more than one lab, a per-lab list opens asking for the PC count
 * in each. Saves the breakdown plus pc_count (= total) that the exam-schedule
 * Batch Builder uses as seating capacity.
 */
export default function OlympiadSchoolLabsPage() {
  const { data: school, isLoading } = useOlympiadMySchool();
  const updateLabs = useUpdateOlympiadLabs();

  const [labCount, setLabCount] = useState<number | "">("");
  const [pcCounts, setPcCounts] = useState<(number | "")[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Pre-fill from the saved breakdown once the school row arrives.
  useEffect(() => {
    if (hydrated || !school) return;
    if (school.lab_pc_counts && school.lab_pc_counts.length > 0) {
      setLabCount(school.lab_pc_counts.length);
      setPcCounts(school.lab_pc_counts);
    } else if (school.pc_count && school.pc_count > 0) {
      setLabCount(1);
      setPcCounts([school.pc_count]);
    }
    setHydrated(true);
  }, [school, hydrated]);

  if (isLoading) {
    return <PageShell><div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-ink-500" /></div></PageShell>;
  }
  if (!school) {
    return <PageShell><p className="py-6 text-sm text-ink-600">No active Olympiad campaign for this school.</p></PageShell>;
  }

  const onLabCountChange = (raw: string) => {
    const next = clampCount(raw, MAX_LABS);
    setLabCount(next);
    if (next === "" || next < 1) {
      setPcCounts([]);
      return;
    }
    // Keep already-entered PC counts when the lab count changes.
    setPcCounts((prev) => Array.from({ length: next }, (_, i) => prev[i] ?? ""));
  };

  const filled = pcCounts.map((c) => (c === "" ? 0 : c));
  const totalPcs = filled.reduce((sum, n) => sum + n, 0);
  const canSave =
    labCount !== "" &&
    labCount >= 1 &&
    pcCounts.length === labCount &&
    pcCounts.every((c) => c !== "" && c > 0);

  const save = () =>
    updateLabs.mutate(
      { olySchoolId: school.id, labPcCounts: filled },
      { onSuccess: () => toast.success("Lab setup saved") },
    );

  return (
    <PageShell>
      <NavLink to="/school/olympiad/resource-planning" className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2">
        <ArrowLeft className="h-4 w-4" /> Resource Planning
      </NavLink>
      <PageHeader
        title="Labs & PCs"
        subtitle="Computer capacity available on exam day"
        icon={<Monitor className="h-6 w-6" />}
      />
      <div className="space-y-4 py-4 max-w-xl">
        <section className="surface-card frosted-shadow rounded-card p-5 space-y-4">
          <div className="grid gap-1.5">
            <Label htmlFor="lab-count" className="text-sm font-medium text-ink-900">
              How many computer labs does the school have?
            </Label>
            <Input
              id="lab-count"
              type="number"
              min={1}
              max={MAX_LABS}
              inputMode="numeric"
              placeholder="e.g. 2"
              value={labCount}
              onChange={(e) => onLabCountChange(e.target.value)}
              className="w-32"
            />
          </div>

          {labCount !== "" && labCount === 1 && (
            <div className="grid gap-1.5">
              <Label htmlFor="pc-0" className="text-sm font-medium text-ink-900">
                How many PCs are in the lab?
              </Label>
              <Input
                id="pc-0"
                type="number"
                min={1}
                max={500}
                inputMode="numeric"
                placeholder="e.g. 30"
                value={pcCounts[0] ?? ""}
                onChange={(e) =>
                  setPcCounts([clampCount(e.target.value, 500)])
                }
                className="w-32"
              />
            </div>
          )}

          {labCount !== "" && labCount > 1 && (
            <div className="space-y-1">
              <p className="text-sm font-medium text-ink-900">How many PCs are in each lab?</p>
              <ul className="divide-y divide-surface-stroke">
                {pcCounts.map((count, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <Label htmlFor={`pc-${i}`} className="text-sm text-ink-900">Lab {i + 1}</Label>
                    <Input
                      id={`pc-${i}`}
                      type="number"
                      min={1}
                      max={500}
                      inputMode="numeric"
                      placeholder="PCs"
                      value={count}
                      onChange={(e) =>
                        setPcCounts((prev) =>
                          prev.map((c, j) => (j === i ? clampCount(e.target.value, 500) : c)),
                        )
                      }
                      className="w-28"
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {labCount !== "" && labCount >= 1 && (
            <div className="flex items-center justify-between border-t border-surface-stroke pt-3">
              <p className="text-sm text-ink-600">
                Total exam-day capacity:{" "}
                <span className="font-semibold text-ink-900">{totalPcs} PC{totalPcs === 1 ? "" : "s"}</span>
              </p>
              <Button onClick={save} disabled={!canSave || updateLabs.isPending}>
                {updateLabs.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </div>
          )}
        </section>

        <p className="text-xs text-ink-500">
          The exam schedule's Batch Builder uses this total as the seating capacity per batch.
        </p>
      </div>
    </PageShell>
  );
}
