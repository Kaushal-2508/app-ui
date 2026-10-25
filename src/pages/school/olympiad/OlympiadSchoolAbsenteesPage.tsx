import { useState } from "react";
import { ArrowLeft, Loader2, UserX, Plus } from "lucide-react";
import { NavLink } from "react-router-dom";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadAbsenteesPool, type AbsenteesStudent } from "@/hooks/olympiad/useOlympiadAbsenteesPool";
import { useLockBatchSchedule } from "@/hooks/olympiad/useLockBatchSchedule";
import { toastError } from "@/lib/toast";

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

export default function OlympiadSchoolAbsenteesPage() {
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: absentees, isLoading: absenteesLoading } = useOlympiadAbsenteesPool(school?.id);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [scheduledAt, setScheduledAt] = useState("");
  const [pcCount, setPcCount] = useState("10");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const lockBatch = useLockBatchSchedule();

  const toggleStudent = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreateBatch = async () => {
    if (!school || !scheduledAt) return;
    const pcs = parseInt(pcCount, 10);
    if (isNaN(pcs) || pcs <= 0) return;

    const selected = (absentees ?? []).filter((s) => selectedIds.has(s.id));
    if (selected.length === 0) return;

    // Group by grade_level_id — one batch per unique grade (or combined if same grade)
    const byGrade = new Map<string, AbsenteesStudent[]>();
    for (const s of selected) {
      const gradeKey = s.grade_level_id ?? "unknown";
      const arr = byGrade.get(gradeKey) ?? [];
      arr.push(s);
      byGrade.set(gradeKey, arr);
    }

    try {
      const batches = Array.from(byGrade.entries()).map(([gradeId, students]) => ({
        scheduled_at: scheduledAt,
        grade_level_id: gradeId === "unknown" ? null : gradeId,
        student_ids: students.map((s) => s.id),
        pc_count: pcs,
        batch_label: `Absentees - ${students[0]?.class_label ?? gradeId}`,
        mergeable: false,
        is_absentees: true,
      }));

      // Absentees batches keep a concrete grade; drop any with unknown grade (defensive).
      // (LockBatch now permits null grade for mixed main batches, but absentees stay single-grade.)
      const validBatches = batches.filter((b): b is typeof b & { grade_level_id: string } => b.grade_level_id !== null);

      await lockBatch.mutateAsync({ oly_school_id: school.id, batches: validBatches });
      setSheetOpen(false);
      setSelectedIds(new Set());
      setScheduledAt("");
      setPcCount("10");
    } catch (err) {
      toastError(err as Error, { fallback: "Couldn't create absentees batch.", context: "createAbsenteesBatch" });
    }
  };

  if (schoolLoading) {
    return (
      <PageShell>
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
        </div>
      </PageShell>
    );
  }

  if (!school) {
    return (
      <PageShell>
        <p className="py-6 text-sm text-ink-600">No active Olympiad campaign.</p>
      </PageShell>
    );
  }

  const hasAbsentees = (absentees ?? []).length > 0;

  return (
    <PageShell>
      <NavLink
        to="/school/olympiad/exam-planning"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Exam Planning
      </NavLink>

      <PageHeader
        title="Absentees"
        subtitle={school.institution_name}
        icon={<UserX className="h-6 w-6" />}
      />

      <div className="space-y-4 py-4">
      {hasAbsentees && (
        <div className="flex items-center justify-end">
          <Button size="sm" onClick={() => setSheetOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Create absentees batch
          </Button>
        </div>
      )}

      <div>
        {absenteesLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : !hasAbsentees ? (
          <EmptyState
            icon={<UserX className="h-8 w-8" />}
            title="No absentees"
            description="All enrolled students are assigned to a batch."
          />
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-ink-600 pb-1">
              {absentees!.length} student{absentees!.length === 1 ? "" : "s"} without an active batch assignment.
            </p>
            {absentees!.map((student) => (
              <div key={student.id} className="surface-card frosted-shadow rounded-card p-3 flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-ink-900 truncate">{student.full_name}</p>
                  <p className="text-[11px] text-ink-500">
                    Roll {student.roll_number} · {student.class_label}
                  </p>
                </div>
                <Badge variant={student.reason === "batch_cancelled" ? "destructive" : "secondary"} className="text-[10px] flex-shrink-0 mt-0.5">
                  {student.reason === "batch_cancelled" ? "Batch cancelled" : "Unassigned"}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create absentees batch sheet */}
      <MobileSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        title="Create absentees batch"
        subtitle="Schedule a makeup exam session for unassigned students"
        primaryAction={{
          label: lockBatch.isPending ? "Creating…" : "Create batch",
          onClick: handleCreateBatch,
          loading: lockBatch.isPending,
          disabled: lockBatch.isPending || selectedIds.size === 0 || !scheduledAt,
        }}
        secondaryAction={{ label: "Cancel", onClick: () => setSheetOpen(false) }}
      >
        <div className="space-y-4 px-4 py-4">
          {/* Date/time */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink-900">Date &amp; time</label>
            <Input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
            />
          </div>

          {/* PC count */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-ink-900">PC count (seats available)</label>
            <Input
              type="number"
              min={1}
              value={pcCount}
              onChange={(e) => setPcCount(e.target.value)}
              placeholder="10"
            />
          </div>

          {/* Student selection */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-ink-900">Select students</p>
            <p className="text-xs text-ink-500">{selectedIds.size} selected</p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {(absentees ?? []).map((student) => (
                <button
                  key={student.id}
                  type="button"
                  onClick={() => toggleStudent(student.id)}
                  className={`w-full text-left flex items-start gap-3 p-3 rounded-card border transition-colors ${
                    selectedIds.has(student.id)
                      ? "border-brand-primary bg-brand-primary/5"
                      : "border-surface-stroke bg-transparent"
                  }`}
                >
                  <div
                    className={`mt-0.5 h-4 w-4 rounded border-2 flex-shrink-0 flex items-center justify-center ${
                      selectedIds.has(student.id)
                        ? "border-brand-primary bg-brand-primary"
                        : "border-ink-400"
                    }`}
                  >
                    {selectedIds.has(student.id) && (
                      <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 10" fill="none">
                        <path d="M1.5 5L4 7.5L8.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-ink-900 truncate">{student.full_name}</p>
                    <p className="text-[11px] text-ink-500">Roll {student.roll_number} · {student.class_label}</p>
                  </div>
                  <Badge variant="secondary" className="text-[10px] flex-shrink-0 mt-0.5">
                    {student.reason === "batch_cancelled" ? "Batch cancelled" : "Unassigned"}
                  </Badge>
                </button>
              ))}
            </div>
          </div>

          {/* Batch preview */}
          {scheduledAt && selectedIds.size > 0 && (
            <div className="surface-card rounded-card border border-surface-stroke p-3 space-y-1">
              <p className="eyebrow">Batch preview</p>
              <p className="text-sm text-ink-900">{formatDate(new Date(scheduledAt).toISOString())}</p>
              <p className="text-xs text-ink-600">{selectedIds.size} students · {pcCount} PCs</p>
            </div>
          )}
        </div>
      </MobileSheet>
      </div>
    </PageShell>
  );
}
