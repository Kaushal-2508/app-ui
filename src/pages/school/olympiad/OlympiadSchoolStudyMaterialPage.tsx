import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ArrowLeft, BookOpen, ExternalLink, FileText, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell } from "@/components/shared/page/PageShell";
import { PageHeader } from "@/components/shared/page/PageHeader";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { useOlympiadMySchool } from "@/hooks/olympiad/useOlympiadMySchool";
import { useOlympiadClasses } from "@/hooks/olympiad/useOlympiadClasses";
import { useOlympiadSubjects } from "@/hooks/olympiad/useOlympiadSubjects";
import { useOlympiadSchoolStudyMaterials } from "@/hooks/olympiad/useOlympiadSchoolStudyMaterials";
import {
  getStudyMaterialSignedUrl,
  type StudyMaterial,
} from "@/hooks/olympiad/useOlympiadStudyMaterials";
import { toastError } from "@/lib/toast";
import { openExternal } from "@/lib/native";

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Stable subject → tone mapping so every file of a subject shares one accent.
const SUBJECT_TONES: Tone[] = ["teal", "violet", "peach", "mint", "sky", "rose"];
function subjectTone(subjectId: string): Tone {
  let h = 0;
  for (let i = 0; i < subjectId.length; i++) h = (h + subjectId.charCodeAt(i)) % 997;
  return SUBJECT_TONES[h % SUBJECT_TONES.length];
}

/**
 * School-staff view of the SALCI-published Olympiad study material — one
 * merged list across all participating classes, narrowed by Class / Subject
 * filters. Read-only: uploads stay super-admin-only.
 */
export default function OlympiadSchoolStudyMaterialPage() {
  const location = useLocation();
  const { data: school, isLoading: schoolLoading } = useOlympiadMySchool();
  const { data: olyClasses = [] } = useOlympiadClasses();
  const { data: subjects = [] } = useOlympiadSubjects();
  const [classFilter, setClassFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState("all");
  const [openingId, setOpeningId] = useState<string | null>(null);

  // Analytics charts deep-link here with a subject NAME (the report RPC
  // doesn't expose ids) — resolve it to the id filter once subjects load.
  const wantedSubjectName = (location.state as { subjectName?: string } | null)?.subjectName;
  const appliedIncoming = useRef(false);
  useEffect(() => {
    if (!wantedSubjectName || appliedIncoming.current || !subjects?.length) return;
    const match = subjects.find((s) => s.name === wantedSubjectName);
    if (match) {
      appliedIncoming.current = true;
      setSubjectFilter(match.id);
    }
  }, [wantedSubjectName, subjects]);

  const participatingClasses = useMemo(() => {
    const allowed = new Set(school?.participating_grade_level_ids ?? []);
    return olyClasses
      .filter((c) => allowed.has(c.grade_level_id))
      .map((c) => ({
        gradeLevelId: c.grade_level_id,
        classLabel: c.grade_number != null ? `Class ${c.grade_number}` : c.grade_name,
      }));
  }, [olyClasses, school?.participating_grade_level_ids]);

  const gradeIds = useMemo(
    () => participatingClasses.map((c) => c.gradeLevelId),
    [participatingClasses],
  );
  const classLabelById = useMemo(
    () => Object.fromEntries(participatingClasses.map((c) => [c.gradeLevelId, c.classLabel])),
    [participatingClasses],
  );
  const subjectNameById = useMemo(
    () => Object.fromEntries((subjects ?? []).map((s) => [s.id, s.name])),
    [subjects],
  );

  const {
    data: materials = [],
    isLoading: materialsLoading,
    isError: materialsError,
  } = useOlympiadSchoolStudyMaterials(gradeIds);

  // Subject filter options come from the materials themselves.
  const subjectOptions = useMemo(
    () =>
      Array.from(new Set(materials.map((m) => m.subject_id)))
        .map((id) => ({ id, name: subjectNameById[id] ?? "?" }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [materials, subjectNameById],
  );

  // One merged list, narrowed by the filters.
  const filtered = useMemo(
    () =>
      materials
        .filter((m) => classFilter === "all" || m.grade_level_id === classFilter)
        .filter((m) => subjectFilter === "all" || m.subject_id === subjectFilter)
        .sort(
          (a, b) =>
            (classLabelById[a.grade_level_id] ?? "").localeCompare(
              classLabelById[b.grade_level_id] ?? "",
              undefined,
              { numeric: true },
            ) ||
            (subjectNameById[a.subject_id] ?? "").localeCompare(subjectNameById[b.subject_id] ?? "") ||
            a.display_order - b.display_order ||
            a.title.localeCompare(b.title),
        ),
    [materials, classFilter, subjectFilter, classLabelById, subjectNameById],
  );

  const hasFilters = classFilter !== "all" || subjectFilter !== "all";

  const handleOpen = async (material: StudyMaterial) => {
    setOpeningId(material.id);
    try {
      const url = await getStudyMaterialSignedUrl(material.storage_path);
      openExternal(url);
    } catch (err) {
      toastError(err as Error, {
        fallback: "Couldn't open study material.",
        context: "openSchoolStudyMaterial",
      });
    } finally {
      setOpeningId(null);
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

  return (
    <PageShell>
      <NavLink
        to="/school/olympiad/exam-planning"
        className="inline-flex items-center gap-1 text-sm text-ink-600 hover:text-ink-900 mb-2"
      >
        <ArrowLeft className="h-4 w-4" /> Exam Planning
      </NavLink>

      <PageHeader
        title="Study Material"
        subtitle={school.institution_name}
        icon={<BookOpen className="h-6 w-6" />}
      />

      <div className="space-y-4 py-4">
        {/* Filters — one merged list across classes and subjects */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue placeholder="Class" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {participatingClasses.map((c) => (
                <SelectItem key={c.gradeLevelId} value={c.gradeLevelId}>{c.classLabel}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={subjectFilter} onValueChange={setSubjectFilter}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All subjects</SelectItem>
              {subjectOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-[12px] tabular-nums text-ink-500">
            {filtered.length} file{filtered.length === 1 ? "" : "s"}
          </span>
        </div>

        {materialsLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : materialsError ? (
          <div className="surface-card frosted-shadow rounded-card p-6 text-center text-sm text-ink-600">
            Couldn't load study material. Please try again.
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<BookOpen className="h-7 w-7" />}
            title={hasFilters ? "No matches" : "No study material yet"}
            description={
              hasFilters
                ? "No study material matches your filters."
                : "SALCI hasn't published study material for your classes yet. It will appear here as soon as it's available."
            }
            reason={hasFilters ? "noResults" : "noData"}
          />
        ) : (
          <div className="space-y-2.5">
            {filtered.map((m) => {
              const t = TONES[subjectTone(m.subject_id)];
              return (
                <div
                  key={m.id}
                  className="surface-card frosted-shadow rounded-card p-4 flex items-center gap-4 transition-shadow hover:shadow-card-lg"
                >
                  <span
                    className={cn(
                      "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl",
                      t.bg,
                      t.fg,
                    )}
                  >
                    <FileText className="h-5 w-5" />
                  </span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-semibold leading-snug text-ink-900 truncate">
                      {m.title}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium",
                          t.bg,
                          t.fg,
                        )}
                      >
                        {subjectNameById[m.subject_id] ?? "?"}
                      </span>
                      <Badge variant="outline" className="text-[10px]">
                        {classLabelById[m.grade_level_id] ?? "?"}
                      </Badge>
                      <span className="text-[11px] tabular-nums text-ink-400">
                        PDF · {formatSize(m.file_size_bytes)}
                      </span>
                    </div>
                    {m.description && (
                      <p className="text-[12px] text-ink-500 truncate">{m.description}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => handleOpen(m)}
                    disabled={openingId === m.id}
                  >
                    {openingId === m.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        <ExternalLink className="h-4 w-4 mr-1" />
                        Open
                      </>
                    )}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </PageShell>
  );
}
