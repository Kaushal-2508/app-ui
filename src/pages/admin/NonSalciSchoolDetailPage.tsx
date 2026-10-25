import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  GraduationCap,
  Users,
} from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import { ListRow, EmptyState } from "@/components/shared/surfaces";
import { MobileTabs } from "@/components/shared/nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useNonSalciSchool } from "@/hooks/olympiad/useNonSalciSchools";
import { useNonSalciSchoolStudents } from "@/hooks/olympiad/useNonSalciSchoolStudents";
import { useOlympiadTeachers } from "@/hooks/olympiad/useOlympiadTeachers";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";
import { OLYMPIAD_SCHOOL_STATUS } from "@/lib/olympiad/schoolStatus";

const CHANNEL_LABEL: Record<string, string> = {
  parent_online: "Online",
  teacher_cash: "Cash",
};

export default function NonSalciSchoolDetailPage() {
  const { olySchoolId } = useParams<{ olySchoolId: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"students" | "teachers">("students");

  const { data: school, isLoading: schoolLoading } = useNonSalciSchool(olySchoolId);

  return (
    <PageShell>
      <button
        type="button"
        onClick={() => navigate("/admin/non-salci-schools")}
        className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Non-SALCI Schools
      </button>

      {schoolLoading ? (
        <Skeleton className="mt-3 h-12 w-2/3 rounded-xl" />
      ) : !school ? (
        <EmptyState
          icon={<Building2 className="h-7 w-7" />}
          title="School not found"
          description="This Non-SALCI school doesn't exist or has been removed."
          reason="noData"
        />
      ) : (
        <>
          <PageHeader
            title={school.institution_name}
            subtitle={`${school.school_short_code}${school.city ? ` · ${school.city}` : ""}${school.state ? `, ${school.state}` : ""}`}
            icon={<Building2 className="h-6 w-6" />}
            extras={
              <Badge variant={OLYMPIAD_SCHOOL_STATUS[school.status]?.variant ?? "secondary"}>
                {OLYMPIAD_SCHOOL_STATUS[school.status]?.label ?? school.status}
              </Badge>
            }
          />

          <MobileTabs
            value={tab}
            onValueChange={(v) => setTab(v as "students" | "teachers")}
            options={[
              { value: "students", label: "Students", count: school.student_count, icon: <Users className="h-4 w-4" /> },
              { value: "teachers", label: "Teachers", count: school.teacher_count, icon: <GraduationCap className="h-4 w-4" /> },
            ]}
            className="mt-2"
          />

          <div className="mt-4">
            {tab === "students" ? (
              <StudentsTab olySchoolId={olySchoolId} />
            ) : (
              <TeachersTab olySchoolId={olySchoolId} />
            )}
          </div>
        </>
      )}
    </PageShell>
  );
}

function StudentsTab({ olySchoolId }: { olySchoolId: string | undefined }) {
  const { data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNonSalciSchoolStudents(olySchoolId);
  const { data: subjects } = useOlympiadSubjects();

  const subjectName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of subjects ?? []) m.set(s.id, s.name);
    return m;
  }, [subjects]);

  const students = useMemo(
    () => (data?.pages ?? []).flatMap((p) => p.rows),
    [data],
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-[120px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (students.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-7 w-7" />}
        title="No students enrolled"
        description="Enrolled students for this school will appear here."
        reason="noData"
        tone="violet"
      />
    );
  }

  return (
    <div className="space-y-3">
      {students.map((s) => {
        const names = s.subject_ids.map((id) => subjectName.get(id) ?? "?").join(", ");
        return (
          <ListRow
            key={s.id}
            leading={
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 text-violet-600">
                <Users className="h-5 w-5" />
              </span>
            }
            title={s.full_name}
            subtitle={`Roll ${s.roll_number} · Class ${s.class_label}${s.section_label ? `-${s.section_label}` : ""}`}
            trailing={
              <Badge variant={s.status === "active" ? "default" : "secondary"}>
                {CHANNEL_LABEL[s.enrollment_channel] ?? s.enrollment_channel}
              </Badge>
            }
            inlineAction={
              <div className="space-y-0.5 text-[12px] leading-[18px] text-ink-500">
                <div>Subjects: {names || "N/A"}</div>
                <div>
                  Parent: {s.parent_name} · {s.parent_phone}
                  {s.parent_email ? ` · ${s.parent_email}` : ""}
                </div>
                <div>
                  DOB: {s.date_of_birth}
                  {s.admission_number ? ` · Adm# ${s.admission_number}` : ""}
                </div>
              </div>
            }
          />
        );
      })}

      {hasNextPage && (
        <div className="pt-1">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading…" : "Load more students"}
          </Button>
        </div>
      )}
    </div>
  );
}

function TeachersTab({ olySchoolId }: { olySchoolId: string | undefined }) {
  const { data: teachers, isLoading } = useOlympiadTeachers(olySchoolId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-[96px] w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!teachers || teachers.length === 0) {
    return (
      <EmptyState
        icon={<GraduationCap className="h-7 w-7" />}
        title="No teachers yet"
        description="Teachers added for this school's Olympiad will appear here."
        reason="noData"
        tone="peach"
      />
    );
  }

  return (
    <div className="space-y-3">
      {teachers.map((t) => (
        <ListRow
          key={t.teacher_profile_id}
          leading={
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/10 text-orange-600">
              <GraduationCap className="h-5 w-5" />
            </span>
          }
          title={t.full_name || "(unnamed teacher)"}
          subtitle={t.email ?? "No email on file"}
          trailing={
            <span className="text-[12px] tabular-nums text-ink-500">
              {t.grade_names.length} {t.grade_names.length === 1 ? "grade" : "grades"}
            </span>
          }
          inlineAction={
            <div className="flex flex-wrap items-center gap-1.5">
              {t.phone && (
                <span className="text-[12px] text-ink-500">{t.phone}</span>
              )}
              {t.grade_names.map((g, i) => (
                <Badge key={`${t.teacher_profile_id}-${i}`} variant="outline" className="text-[11px]">
                  {g}
                </Badge>
              ))}
            </div>
          }
        />
      ))}
    </div>
  );
}
