import { useEffect, useMemo, useState } from "react";
import { Target } from "lucide-react";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useWings } from "@/hooks/useWings";
import { useWingMembers, useInstitutionMembers } from "@/hooks/useWingMembers";
import { useCreateWingTarget, useCreateTeacherTargets } from "@/hooks/useTeacherTargets";
import {
  periodsFor,
  parseDateOnly,
  formatDisplayDate,
  type CadenceUnit,
  type TargetMetric,
} from "@/lib/targetPeriods";

type TargetKind = "wing" | "direct";
type CadencePreset = "one_off" | "weekly" | "every_15_days" | "monthly" | "quarterly";

const CADENCE_PRESETS: Record<CadencePreset, { label: string; unit: CadenceUnit | null; n: number | null }> = {
  one_off: { label: "One-off, no repeat", unit: null, n: null },
  weekly: { label: "Weekly", unit: "week", n: 1 },
  every_15_days: { label: "Every 15 days", unit: "day", n: 15 },
  monthly: { label: "Monthly", unit: "month", n: 1 },
  quarterly: { label: "Quarterly", unit: "month", n: 3 },
};

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface CreateTargetSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  institutionId: string | null;
}

/**
 * Admin-only create flow: a wing pool handed to one coordinator, or a target
 * assigned directly to named teachers. Both write RPCs are administrators
 * only, so this sheet is never opened from the coordinator's own view
 * (TeacherTargetsPage gates the trigger on `isAdmin`).
 */
export function CreateTargetSheet({ open, onOpenChange, institutionId }: CreateTargetSheetProps) {
  const [kind, setKind] = useState<TargetKind>("wing");
  const [metric, setMetric] = useState<TargetMetric>("exams_published");
  const [wingId, setWingId] = useState<string>("");
  const [coordinatorId, setCoordinatorId] = useState<string>("");
  const [teacherIds, setTeacherIds] = useState<string[]>([]);
  const [teacherFilter, setTeacherFilter] = useState("");
  const [targetValue, setTargetValue] = useState("5");
  const [startsOn, setStartsOn] = useState(todayIso());
  const [endsOn, setEndsOn] = useState("");
  const [cadence, setCadence] = useState<CadencePreset>("monthly");
  const [note, setNote] = useState("");

  const { data: wings } = useWings(institutionId);
  const { data: wingMembers } = useWingMembers(wingId || null);
  const { data: institutionMembers } = useInstitutionMembers(institutionId);

  const coordinatorOptions = useMemo(
    () => (wingMembers ?? []).filter((m) => m.role === "coordinator"),
    [wingMembers],
  );
  const teacherOptions = useMemo(
    () =>
      (institutionMembers ?? [])
        .filter((m) => m.role === "teacher" || m.role === "coordinator")
        .filter((m) => m.full_name.toLowerCase().includes(teacherFilter.trim().toLowerCase())),
    [institutionMembers, teacherFilter],
  );

  // The coordinator choice only makes sense for the wing currently selected.
  useEffect(() => {
    setCoordinatorId("");
  }, [wingId]);

  const resetForm = () => {
    setKind("wing");
    setMetric("exams_published");
    setWingId("");
    setCoordinatorId("");
    setTeacherIds([]);
    setTeacherFilter("");
    setTargetValue("5");
    setStartsOn(todayIso());
    setEndsOn("");
    setCadence("monthly");
    setNote("");
  };

  const createWing = useCreateWingTarget();
  const createTeachers = useCreateTeacherTargets();
  const saving = createWing.isPending || createTeachers.isPending;

  const numericTarget = Number(targetValue);
  const datesValid = !!startsOn && !!endsOn && startsOn <= endsOn;
  const canSave =
    Number.isFinite(numericTarget) &&
    numericTarget > 0 &&
    datesValid &&
    (kind === "wing" ? !!wingId && !!coordinatorId : teacherIds.length > 0);

  const preview = useMemo(() => {
    if (!datesValid) return [];
    const preset = CADENCE_PRESETS[cadence];
    return periodsFor(parseDateOnly(startsOn), parseDateOnly(endsOn), preset.unit, preset.n).slice(0, 3);
  }, [datesValid, startsOn, endsOn, cadence]);

  const handleSave = () => {
    if (!canSave) return;
    const preset = CADENCE_PRESETS[cadence];
    const shared = {
      metric,
      targetValue: numericTarget,
      startsOn,
      endsOn,
      cadenceUnit: preset.unit,
      cadenceN: preset.n,
      note: note.trim() || null,
    };
    const onSuccess = () => {
      resetForm();
      onOpenChange(false);
    };
    if (kind === "wing") {
      createWing.mutate({ ...shared, wingId, coordinatorId }, { onSuccess });
    } else {
      createTeachers.mutate({ ...shared, teacherIds }, { onSuccess });
    }
  };

  const toggleTeacher = (id: string) => {
    setTeacherIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Set a target"
      subtitle="Hand a wing a pooled target, or assign one directly to named teachers"
      icon={<Target className="h-4 w-4" />}
      desktopWidth="md"
      primaryAction={{ label: "Save target", onClick: handleSave, disabled: !canSave, loading: saving }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label>Measure</Label>
          <ToggleGroup
            type="single"
            value={metric}
            onValueChange={(v) => v && setMetric(v as TargetMetric)}
            className="grid grid-cols-2 gap-2"
          >
            <ToggleGroupItem
              value="exams_published"
              className="h-10 rounded-lg border border-surface-stroke data-[state=on]:bg-brand-primary data-[state=on]:text-white"
            >
              Exams published
            </ToggleGroupItem>
            <ToggleGroupItem
              value="homework_published"
              className="h-10 rounded-lg border border-surface-stroke data-[state=on]:bg-brand-primary data-[state=on]:text-white"
            >
              Homework published
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        <div className="space-y-2">
          <Label>Target type</Label>
          <ToggleGroup
            type="single"
            value={kind}
            onValueChange={(v) => v && setKind(v as TargetKind)}
            className="grid grid-cols-2 gap-2"
          >
            <ToggleGroupItem
              value="wing"
              className="h-10 rounded-lg border border-surface-stroke data-[state=on]:bg-brand-primary data-[state=on]:text-white"
            >
              Wing pool
            </ToggleGroupItem>
            <ToggleGroupItem
              value="direct"
              className="h-10 rounded-lg border border-surface-stroke data-[state=on]:bg-brand-primary data-[state=on]:text-white"
            >
              Named teachers
            </ToggleGroupItem>
          </ToggleGroup>
        </div>

        {kind === "wing" ? (
          <>
            <div className="space-y-2">
              <Label htmlFor="target-wing">Wing</Label>
              <Select value={wingId} onValueChange={setWingId}>
                <SelectTrigger id="target-wing">
                  <SelectValue placeholder="Choose a wing" />
                </SelectTrigger>
                <SelectContent>
                  {(wings ?? []).map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="target-coordinator">Coordinator</Label>
              <Select value={coordinatorId} onValueChange={setCoordinatorId} disabled={!wingId}>
                <SelectTrigger id="target-coordinator">
                  <SelectValue
                    placeholder={wingId ? "Choose the coordinator" : "Choose a wing first"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {coordinatorOptions.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {wingId && coordinatorOptions.length === 0 && (
                <p className="text-xs text-amber-700">
                  No coordinator is assigned to this wing yet. Assign one from Wings and Coordinators first.
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <Label htmlFor="target-teacher-filter">Teachers</Label>
            <Input
              id="target-teacher-filter"
              placeholder="Search by name"
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
            />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-surface-stroke p-2">
              {teacherOptions.length === 0 ? (
                <p className="p-2 text-sm text-ink-500">No matching teachers.</p>
              ) : (
                teacherOptions.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-ink-400/5"
                  >
                    <Checkbox
                      checked={teacherIds.includes(t.id)}
                      onCheckedChange={() => toggleTeacher(t.id)}
                    />
                    <span className="min-w-0 truncate">{t.full_name}</span>
                  </label>
                ))
              )}
            </div>
            {teacherIds.length > 0 && (
              <p className="text-xs text-ink-500">{teacherIds.length} teacher{teacherIds.length === 1 ? "" : "s"} selected</p>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="target-value">Target number</Label>
            <Input
              id="target-value"
              type="number"
              min={1}
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target-cadence">Cadence</Label>
            <Select value={cadence} onValueChange={(v) => setCadence(v as CadencePreset)}>
              <SelectTrigger id="target-cadence">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(CADENCE_PRESETS) as CadencePreset[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {CADENCE_PRESETS[key].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor="target-starts">Starts on</Label>
            <Input
              id="target-starts"
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target-ends">Ends on</Label>
            <Input
              id="target-ends"
              type="date"
              min={startsOn || undefined}
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
            />
          </div>
        </div>
        {startsOn && endsOn && !datesValid && (
          <p className="text-xs text-rose-600">The end date must be on or after the start date.</p>
        )}

        {preview.length > 0 && (
          <div className="space-y-1 rounded-lg bg-ink-400/5 p-3">
            <p className="text-xs font-medium text-ink-700">Preview: how this will be measured</p>
            {preview.map((p) => (
              <p key={p.index} className="text-xs text-ink-500">
                Period {p.index}: {formatDisplayDate(p.start)} to {formatDisplayDate(p.end)}
              </p>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="target-note">Note (optional)</Label>
          <Textarea
            id="target-note"
            placeholder="Anything the coordinator or teacher should know"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </MobileSheet>
  );
}
