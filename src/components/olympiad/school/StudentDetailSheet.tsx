import { useNavigate } from "react-router-dom";
import {
  Banknote,
  CalendarDays,
  CreditCard,
  Hash,
  IdCard,
  LayoutDashboard,
  Lock,
  Mail,
  Phone,
  User,
  Cake,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { cn } from "@/lib/utils";
import type { RosterStudent } from "@/hooks/olympiad/useOlympiadClassRoster";
import type { StudentResultRow } from "@/hooks/olympiad/useOlympiadStudentResults";

const TIER_CHIP: Record<string, { label: string; cls: string }> = {
  gold: { label: "Gold", cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" },
  silver: { label: "Silver", cls: "bg-slate-200 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300" },
  bronze: { label: "Bronze", cls: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300" },
  participation: { label: "Participation", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  absent: { label: "Absent", cls: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
};

const fmtDate = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" })
    : null;

function GlanceItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-stroke px-3 py-2.5">
      <p className="eyebrow flex items-center gap-1.5">
        <span className="text-brand-primary">{icon}</span>
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-medium text-ink-900">
        {value || <span className="text-ink-400">N/A</span>}
      </p>
    </div>
  );
}

/**
 * Student profile sheet for the school-admin roster. Leads with the result
 * strip + "Open dashboard" CTA (live once the student's result is published),
 * followed by an at-a-glance grid, subjects, and parent contact card.
 */
export function StudentDetailSheet({
  student,
  onOpenChange,
  subjectNameById,
  result,
  onOpenDashboard,
  dashboardLabel = "Open dashboard",
}: {
  student: RosterStudent | null;
  onOpenChange: (open: boolean) => void;
  subjectNameById: Record<string, string>;
  /** Published result for this student, if any — drives the top strip. */
  result?: StudentResultRow | null;
  /** Override the result CTA. Default navigates to the school student dashboard
   *  (school_admin-only route); the teacher roster passes this to open the
   *  per-student scorecard sheet instead. */
  onOpenDashboard?: () => void;
  dashboardLabel?: string;
}) {
  const navigate = useNavigate();
  if (!student) return null;

  const isCash = student.enrollment_channel === "teacher_cash";
  const isAbsent = result?.certificate_tier === "absent";
  const tier = result ? TIER_CHIP[result.certificate_tier] : null;

  const openDashboard = () => {
    if (onOpenDashboard) {
      onOpenDashboard();
      return;
    }
    onOpenChange(false);
    navigate(`/school/olympiad/students/${student.id}/dashboard`);
  };

  return (
    <MobileSheet
      open={!!student}
      onOpenChange={onOpenChange}
      title={student.full_name}
      subtitle={`${student.class_label}${student.section_label ? ` · Section ${student.section_label}` : ""}`}
      primaryAction={{ label: "Done", onClick: () => onOpenChange(false) }}
    >
      <div className="space-y-5 px-4 py-4">
        {/* Result strip — dashboard access lives at the TOP of the sheet */}
        {result && !isAbsent ? (
          <section className="rounded-card bg-gradient-to-r from-brand-primary/50 via-brand-secondary/35 to-brand-primary/50 p-[1.5px]">
            <div className="surface-card rounded-card flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="eyebrow">Result</p>
                <p className="mt-0.5 text-xl font-bold tabular-nums text-ink-900">
                  {Math.round(result.percentage * 10) / 10}%
                  {tier && (
                    <span className={cn("ml-2 align-middle inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold", tier.cls)}>
                      {tier.label}
                    </span>
                  )}
                </p>
                {result.class_rank != null && (
                  <p className="text-[11px] text-ink-500">
                    Class rank #{result.class_rank} of {result.class_total}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={openDashboard}>
                <LayoutDashboard className="mr-1.5 h-4 w-4" />
                {dashboardLabel}
              </Button>
            </div>
          </section>
        ) : (
          <section className="flex items-start gap-2.5 rounded-card border border-dashed border-surface-stroke p-4">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-brand-secondary" />
            <p className="text-sm leading-snug text-ink-600">
              {isAbsent
                ? "This student was marked absent. No performance dashboard is available."
                : "The performance dashboard unlocks once this student's result is published."}
            </p>
          </section>
        )}

        {/* At a glance */}
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-ink-900">At a glance</h4>
          <div className="grid grid-cols-2 gap-2.5">
            <GlanceItem icon={<Hash className="h-3 w-3" />} label="Student ID (roll)" value={student.roll_number} />
            <GlanceItem icon={<IdCard className="h-3 w-3" />} label="Admission no." value={student.admission_number} />
            <GlanceItem icon={<Cake className="h-3 w-3" />} label="Date of birth" value={fmtDate(student.date_of_birth)} />
            <GlanceItem icon={<CalendarDays className="h-3 w-3" />} label="Enrolled on" value={fmtDate(student.enrolled_at)} />
            <GlanceItem
              icon={isCash ? <Banknote className="h-3 w-3" /> : <CreditCard className="h-3 w-3" />}
              label="Payment"
              value={isCash ? "Cash at school" : "Online by parent"}
            />
            <GlanceItem
              icon={<User className="h-3 w-3" />}
              label="Status"
              value={<span className="capitalize">{student.status}</span>}
            />
          </div>
        </section>

        {/* Subjects */}
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-ink-900">Participating subjects</h4>
          <div className="flex flex-wrap gap-1.5">
            {student.subject_ids.map((id) => (
              <Badge key={id} variant="secondary" className="text-[11px]">
                {subjectNameById[id] ?? "?"}
              </Badge>
            ))}
          </div>
        </section>

        {/* Parent / guardian */}
        <section className="space-y-2">
          <h4 className="text-sm font-semibold text-ink-900">Parent / guardian</h4>
          <div className="rounded-card border border-surface-stroke divide-y divide-surface-stroke">
            <div className="flex items-center gap-3 px-3 py-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-primary/10 text-xs font-semibold text-brand-primary">
                <User className="h-4 w-4" />
              </span>
              <p className="truncate text-sm font-medium text-ink-900">
                {student.parent_name || <span className="text-ink-400">N/A</span>}
              </p>
            </div>
            {student.parent_phone && (
              <a href={`tel:${student.parent_phone}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                <Phone className="h-4 w-4 shrink-0 text-ink-500" />
                <span className="text-sm text-ink-900 tabular-nums">{student.parent_phone}</span>
              </a>
            )}
            {student.parent_email && (
              <a href={`mailto:${student.parent_email}`} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                <Mail className="h-4 w-4 shrink-0 text-ink-500" />
                <span className="truncate text-sm text-ink-900">{student.parent_email}</span>
              </a>
            )}
          </div>
        </section>
      </div>
    </MobileSheet>
  );
}
