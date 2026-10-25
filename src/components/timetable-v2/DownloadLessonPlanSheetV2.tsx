import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
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
import { Skeleton } from "@/components/ui/skeleton";
import { toastError } from "@/lib/toast";
import {
  useLessonPlanExportFilters,
  fetchLessonPlanExport,
  type ExportPeriod,
  type ExportCombo,
} from "@/hooks/useLessonPlanExport";
import { buildLessonPlanWorkbook } from "@/lib/lessonPlanExport";
import { saveBlob } from "@/lib/native";

const ALL = "__all__";

const PERIOD_OPTIONS: { value: ExportPeriod; label: string; hint: string }[] = [
  { value: "week", label: "Weekly", hint: "This week so far" },
  { value: "month", label: "Monthly", hint: "This month so far" },
  { value: "year", label: "Yearly", hint: "This academic year so far" },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * "Download Lesson Plan" — coordinator/admin export. Period + optional
 * teacher/class/section/subject filters; scope (whole institution vs the
 * coordinator's wings) is resolved server-side, so with no filter applied it
 * returns every in-scope combination. Builds a two-sheet Excel workbook.
 */
export default function DownloadLessonPlanSheetV2({ open, onOpenChange }: Props) {
  const [period, setPeriod] = useState<ExportPeriod>("month");
  const [classGroup, setClassGroup] = useState<string>(ALL);
  const [section, setSection] = useState<string>(ALL);
  const [teacher, setTeacher] = useState<string>(ALL);
  const [subject, setSubject] = useState<string>(ALL);
  const [busy, setBusy] = useState(false);

  const filtersQuery = useLessonPlanExportFilters(open);
  const filters = filtersQuery.data;

  // Faceted filtering — each dropdown's options are constrained by the OTHER
  // active selections, derived from the real teacher×class×section×subject
  // tuples (`combos`). So a teacher only appears for classes they actually
  // teach, a subject only for sections where it's scheduled, and so on. Each
  // field's available set is computed EXCLUDING its own constraint (`skip`),
  // so the field can still be changed freely.
  const avail = useMemo(() => {
    const combos = filters?.combos ?? [];
    const ok = (c: ExportCombo, skip: "cg" | "sec" | "teacher" | "subject") =>
      (skip === "cg" || classGroup === ALL || c.class_group_id === classGroup) &&
      (skip === "sec" || section === ALL || c.section_id === section) &&
      (skip === "teacher" || teacher === ALL || c.teacher_id === teacher) &&
      (skip === "subject" || subject === ALL || c.subject_id === subject);
    return {
      classGroups: new Set(combos.filter((c) => ok(c, "cg")).map((c) => c.class_group_id)),
      sections: new Set(combos.filter((c) => ok(c, "sec")).map((c) => c.section_id)),
      teachers: new Set(combos.filter((c) => ok(c, "teacher")).map((c) => c.teacher_id)),
      subjects: new Set(combos.filter((c) => ok(c, "subject")).map((c) => c.subject_id)),
    };
  }, [filters?.combos, classGroup, section, teacher, subject]);

  // Drop any selection that's no longer compatible with the others (cascade).
  useEffect(() => {
    if (classGroup !== ALL && !avail.classGroups.has(classGroup)) setClassGroup(ALL);
    if (section !== ALL && !avail.sections.has(section)) setSection(ALL);
    if (teacher !== ALL && !avail.teachers.has(teacher)) setTeacher(ALL);
    if (subject !== ALL && !avail.subjects.has(subject)) setSubject(ALL);
  }, [avail, classGroup, section, teacher, subject]);

  // Start clean each time the sheet opens.
  useEffect(() => {
    if (open) {
      setClassGroup(ALL);
      setSection(ALL);
      setTeacher(ALL);
      setSubject(ALL);
    }
  }, [open]);

  const handleDownload = async () => {
    setBusy(true);
    try {
      const data = await fetchLessonPlanExport({
        period,
        classGroupId: classGroup === ALL ? null : classGroup,
        classId: section === ALL ? null : section,
        teacherId: teacher === ALL ? null : teacher,
        subjectId: subject === ALL ? null : subject,
      });
      if (data.delivery_log.length === 0 && data.chapter_delivery.length === 0) {
        toast.info("No lesson-plan data for the selected scope and period.");
        return;
      }
      const blob = await buildLessonPlanWorkbook(data);
      const stamp = data.meta.generated_on.replace(/ /g, "-");
      saveBlob(blob, `Lesson_Plan_Delivery_${period}_${stamp}.xlsx`);
      toast.success("Lesson plan downloaded");
      onOpenChange(false);
    } catch (err) {
      toastError(err as Error, {
        fallback: "Couldn't generate the lesson plan.",
        context: "lessonPlanExport",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2 text-ink-900">
            <FileSpreadsheet className="h-5 w-5 text-brand-primary" />
            Download Lesson Plan
          </SheetTitle>
          <SheetDescription>
            A worksheet of what each teacher has planned and taught, slot by slot, with
            unfilled lesson plans flagged. Leave a filter on “All” to include everything in
            your scope.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {/* Period */}
          <div className="space-y-2">
            <Label className="text-sm font-medium text-ink-700">Period</Label>
            <RadioGroup
              value={period}
              onValueChange={(v) => setPeriod(v as ExportPeriod)}
              className="grid grid-cols-3 gap-2"
            >
              {PERIOD_OPTIONS.map((o) => (
                <label
                  key={o.value}
                  htmlFor={`lp-period-${o.value}`}
                  className="flex cursor-pointer flex-col items-center gap-1 rounded-xl border border-surface-stroke p-3 text-center has-[:checked]:border-brand-primary has-[:checked]:bg-brand-primary/5"
                >
                  <RadioGroupItem id={`lp-period-${o.value}`} value={o.value} className="sr-only" />
                  <span className="text-sm font-medium text-ink-900">{o.label}</span>
                  <span className="text-[11px] text-ink-500">{o.hint}</span>
                </label>
              ))}
            </RadioGroup>
          </div>

          {filtersQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-10 w-full rounded-xl" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <FilterSelect
                label="Class"
                value={classGroup}
                onChange={setClassGroup}
                placeholder="All classes"
                options={(filters?.class_groups ?? [])
                  .filter((c) => avail.classGroups.has(c.id))
                  .map((c) => ({ id: c.id, label: c.name }))}
              />
              <FilterSelect
                label="Section"
                value={section}
                onChange={setSection}
                placeholder="All sections"
                options={(filters?.sections ?? [])
                  .filter((s) => avail.sections.has(s.id))
                  .map((s) => ({
                    id: s.id,
                    label: s.section ? `${s.class} – ${s.section}` : s.class,
                  }))}
              />
              <FilterSelect
                label="Teacher"
                value={teacher}
                onChange={setTeacher}
                placeholder="All teachers"
                options={(filters?.teachers ?? [])
                  .filter((t) => avail.teachers.has(t.id))
                  .map((t) => ({ id: t.id, label: t.name }))}
              />
              <FilterSelect
                label="Subject"
                value={subject}
                onChange={setSubject}
                placeholder="All subjects"
                options={(filters?.subjects ?? [])
                  .filter((s) => avail.subjects.has(s.id))
                  .map((s) => ({ id: s.id, label: s.name }))}
              />
            </div>
          )}

          <Button
            onClick={handleDownload}
            disabled={busy || filtersQuery.isLoading}
            className="w-full rounded-xl bg-brand-primary text-white hover:bg-brand-primary/90"
          >
            {busy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Preparing…
              </>
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Download Excel
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  placeholder,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { id: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium text-ink-700">{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 w-full rounded-xl">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{placeholder}</SelectItem>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
