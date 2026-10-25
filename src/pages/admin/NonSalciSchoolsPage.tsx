import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, GraduationCap, Search, Users } from "lucide-react";

import { PageShell, PageHeader } from "@/components/shared/page";
import {
  StatTile,
  StatTileGrid,
  ListRow,
  EmptyState,
} from "@/components/shared/surfaces";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useNonSalciSchools } from "@/hooks/olympiad/useNonSalciSchools";
import { OLYMPIAD_SCHOOL_STATUS } from "@/lib/olympiad/schoolStatus";

export default function NonSalciSchoolsPage() {
  const navigate = useNavigate();
  const { data: schools, isLoading } = useNonSalciSchools();
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const list = schools ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.institution_name.toLowerCase().includes(q) ||
        s.school_short_code.toLowerCase().includes(q) ||
        (s.city ?? "").toLowerCase().includes(q),
    );
  }, [schools, search]);

  const totals = useMemo(() => {
    const list = schools ?? [];
    return {
      schools: list.length,
      students: list.reduce((sum, s) => sum + s.student_count, 0),
      teachers: list.reduce((sum, s) => sum + s.teacher_count, 0),
    };
  }, [schools]);

  return (
    <PageShell>
      <PageHeader
        title="Non-SALCI Schools"
        subtitle="Schools onboarded only for the Olympiad, every student and teacher in one place."
        icon={<Building2 className="h-6 w-6" />}
      />

      <StatTileGrid cols={3} mdCols={3}>
        <StatTile label="Schools" value={totals.schools} icon={<Building2 className="h-5 w-5" />} tone="teal" />
        <StatTile label="Students" value={totals.students} icon={<Users className="h-5 w-5" />} tone="violet" />
        <StatTile label="Teachers" value={totals.teachers} icon={<GraduationCap className="h-5 w-5" />} tone="peach" />
      </StatTileGrid>

      <div className="relative mt-6">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by school, code, or city…"
          className="pl-9"
        />
      </div>

      <div className="mt-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] w-full rounded-2xl" />
          ))
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Building2 className="h-7 w-7" />}
            title={search ? "No matches" : "No onboarded schools yet"}
            description={
              search
                ? "No Non-SALCI school matches your search."
                : "Schools onboarded purely for the Olympiad will appear here once created."
            }
            reason={search ? "noResults" : "noData"}
          />
        ) : (
          filtered.map((s) => {
            const meta = OLYMPIAD_SCHOOL_STATUS[s.status];
            return (
              <ListRow
                key={s.id}
                onClick={() => navigate(`/admin/non-salci-schools/${s.id}`)}
                leading={
                  <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                    <Building2 className="h-5 w-5" />
                  </span>
                }
                title={s.institution_name}
                subtitle={`${s.school_short_code}${s.city ? ` · ${s.city}` : ""}`}
                trailing={
                  <div className="flex flex-col items-end gap-1">
                    <Badge variant={meta?.variant ?? "secondary"}>
                      {meta?.label ?? s.status}
                    </Badge>
                    <span className="text-[12px] tabular-nums text-ink-500">
                      {s.student_count} students · {s.teacher_count} teachers
                    </span>
                  </div>
                }
              />
            );
          })
        )}
      </div>
    </PageShell>
  );
}
