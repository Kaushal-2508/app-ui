import { useMemo, useState } from "react";
import { PageShell, PageHeader } from "@/components/shared/page";
import { MobileSheet } from "@/components/shared/sheets";
import { EmptyState } from "@/components/shared/surfaces";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers, Plus, Users, BookOpen, GraduationCap, Trash2, Loader2 } from "lucide-react";
import { useUserRole } from "@/hooks/useUserRole";
import { useInstitutionTeachers } from "@/hooks/useClasses";
import { currentAcademicYear } from "@/hooks/useAcademicCalendar";
import {
  useOptionalBatches,
  useInstitutionOptionalSubjects,
  useUpsertOptionalBatch,
  useDeleteOptionalBatch,
  useOptionalBatchRoster,
  useOptionalSubjectEnrolledStudents,
  useToggleBatchStudent,
  type OptionalBatch,
} from "@/hooks/useOptionalBatches";

export default function OptionalBatchesPage() {
  const { data: roleInfo } = useUserRole();
  const institutionId = roleInfo?.institutionId ?? null;
  const academicYear = currentAcademicYear();

  const { data: batches = [], isLoading } = useOptionalBatches(institutionId, academicYear);
  const { data: optionalSubjects = [] } = useInstitutionOptionalSubjects(institutionId);
  const { data: teachers = [] } = useInstitutionTeachers(institutionId);
  const upsertBatch = useUpsertOptionalBatch();
  const deleteBatch = useDeleteOptionalBatch();

  const [createOpen, setCreateOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [teacherId, setTeacherId] = useState("");
  const [label, setLabel] = useState("");

  const [rosterBatch, setRosterBatch] = useState<OptionalBatch | null>(null);

  const resetCreate = () => {
    setSubjectId("");
    setTeacherId("");
    setLabel("");
  };

  const handleCreate = async () => {
    if (!institutionId || !subjectId || !label.trim()) return;
    try {
      await upsertBatch.mutateAsync({
        institution_id: institutionId,
        academic_year: academicYear,
        subject_id: subjectId,
        teacher_id: teacherId || null,
        label: label.trim(),
      });
      resetCreate();
      setCreateOpen(false);
    } catch {
      /* error toasted by the hook */
    }
  };

  return (
    <PageShell>
      <PageHeader
        title="Optional Batches"
        subtitle={`Teaching groups for optional subjects · ${academicYear}`}
        icon={<Layers className="h-5 w-5" />}
        primaryAction={{
          label: "New batch",
          icon: <Plus className="h-4 w-4" />,
          onClick: () => setCreateOpen(true),
          disabled: optionalSubjects.length === 0,
        }}
      />

      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-7 w-7 animate-spin text-muted-foreground" />
        </div>
      ) : optionalSubjects.length === 0 ? (
        <EmptyState
          icon={<BookOpen className="h-7 w-7" />}
          title="No optional subjects yet"
          description="Mark a subject as optional (from a class's subjects) before creating batches for it."
          reason="noData"
        />
      ) : batches.length === 0 ? (
        <EmptyState
          icon={<Layers className="h-7 w-7" />}
          title="No batches yet"
          description="Create a batch to group the students who take an optional subject, across one or many sections."
          action={{ label: "New batch", onClick: () => setCreateOpen(true), icon: <Plus className="h-4 w-4" /> }}
          reason="noData"
        />
      ) : (
        <div className="space-y-3">
          {batches.map((b) => (
            <Card key={b.id} className="surface-card frosted-shadow rounded-card">
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                  <Layers className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-ink-900">{b.label}</p>
                  <p className="truncate text-sm text-ink-600">
                    {b.subject_name}
                    {b.teacher_name ? ` · ${b.teacher_name}` : " · No teacher"}
                  </p>
                </div>
                <Badge variant="secondary" className="shrink-0 gap-1">
                  <Users className="h-3 w-3" />
                  {b.roster_count}
                </Badge>
                <Button variant="outline" size="sm" onClick={() => setRosterBatch(b)}>
                  Roster
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-rose-600 hover:text-rose-700"
                  onClick={() => {
                    if (institutionId) deleteBatch.mutate({ id: b.id, institution_id: institutionId });
                  }}
                  aria-label="Delete batch"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create batch sheet */}
      <MobileSheet
        open={createOpen}
        onOpenChange={(o) => {
          setCreateOpen(o);
          if (!o) resetCreate();
        }}
        title="New optional batch"
        subtitle="Pick the subject and teacher, then build the roster"
        icon={<Layers className="h-5 w-5" />}
        primaryAction={{
          label: "Create batch",
          onClick: handleCreate,
          loading: upsertBatch.isPending,
          disabled: !subjectId || !label.trim(),
        }}
        secondaryAction={{ label: "Cancel", onClick: () => setCreateOpen(false) }}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Optional subject *</Label>
            <Select value={subjectId} onValueChange={setSubjectId}>
              <SelectTrigger>
                <SelectValue placeholder="Select an optional subject" />
              </SelectTrigger>
              <SelectContent>
                {optionalSubjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Teacher</Label>
            <Select value={teacherId} onValueChange={setTeacherId}>
              <SelectTrigger>
                <SelectValue placeholder="Assign a teacher (optional)" />
              </SelectTrigger>
              <SelectContent>
                {teachers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.full_name || t.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="batchLabel">Batch name *</Label>
            <Input
              id="batchLabel"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., French · Batch A"
            />
          </div>
        </div>
      </MobileSheet>

      {/* Roster sheet */}
      <BatchRosterSheet
        batch={rosterBatch}
        institutionId={institutionId}
        onClose={() => setRosterBatch(null)}
      />
    </PageShell>
  );
}

function BatchRosterSheet({
  batch,
  institutionId,
  onClose,
}: {
  batch: OptionalBatch | null;
  institutionId: string | null;
  onClose: () => void;
}) {
  const { data: candidates = [], isLoading } = useOptionalSubjectEnrolledStudents(
    batch?.subject_id ?? null,
    institutionId,
  );
  const { data: roster } = useOptionalBatchRoster(batch?.id ?? null);
  const toggle = useToggleBatchStudent();

  const rosterSet = useMemo(() => roster ?? new Set<string>(), [roster]);

  return (
    <MobileSheet
      open={!!batch}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={batch ? `Roster · ${batch.label}` : "Roster"}
      subtitle={batch ? `${batch.subject_name} · students enrolled in this subject` : undefined}
      icon={<Users className="h-5 w-5" />}
      secondaryAction={{ label: "Done", onClick: onClose }}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : candidates.length === 0 ? (
        <EmptyState
          icon={<GraduationCap className="h-7 w-7" />}
          title="No enrolled students"
          description="Enroll students in this optional subject (from their profile → Subjects tab) before adding them to a batch."
          reason="noData"
        />
      ) : (
        <div className="space-y-1">
          {candidates.map((s) => {
            const inRoster = rosterSet.has(s.student_id);
            return (
              <label
                key={s.student_id}
                className="flex cursor-pointer items-center gap-3 rounded-lg p-2 hover:bg-muted/50"
              >
                <Checkbox
                  checked={inRoster}
                  disabled={toggle.isPending || !batch}
                  onCheckedChange={(checked) => {
                    if (batch) {
                      toggle.mutate({ batchId: batch.id, studentId: s.student_id, add: !!checked });
                    }
                  }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-900">{s.full_name}</p>
                  <p className="truncate text-xs text-ink-600">
                    {s.roll_number ? `Roll ${s.roll_number}` : ""}
                    {s.class_label ? `${s.roll_number ? " · " : ""}${s.class_label}` : ""}
                  </p>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </MobileSheet>
  );
}
