import { useState, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsolatedStudyMaterials } from "@/hooks/useIsolatedStudyMaterials";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { StudentSyllabusSegments } from "@/components/syllabus/segments/StudentSyllabusSegments";
import {
  BookOpen,
  FileText,
  Video,
  ExternalLink,
  Search,
  GraduationCap,
  Library,
  Calendar,
} from "lucide-react";
import { PageShell, PageHeader } from "@/components/shared/page";
import { supabase } from "@/integrations/supabase/client";
import { EmptyState } from "@/components/shared/surfaces/EmptyState";
import { TONES, type Tone } from "@/components/shared/design-system";
import { cn } from "@/lib/utils";
import { openExternal } from "@/lib/native";

type SortOption = "newest" | "oldest" | "a-z" | "z-a";
type FilterType = "all" | "pdf" | "video" | "book" | "link";

const TYPE_FILTERS: { id: FilterType; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pdf", label: "PDFs" },
  { id: "video", label: "Videos" },
  { id: "book", label: "Books" },
  { id: "link", label: "Links" },
];

/** Dark-mode-safe tinted disc per material type (reuses the shared TONES). */
function materialTone(type: string): Tone {
  if (type === "pdf") return "rose";
  if (type === "video") return "violet";
  if (type === "book") return "sky";
  return "mint";
}

function materialIcon(type: string) {
  if (type === "book") return <BookOpen className="h-5 w-5" />;
  if (type === "pdf") return <FileText className="h-5 w-5" />;
  if (type === "video") return <Video className="h-5 w-5" />;
  return <ExternalLink className="h-5 w-5" />;
}

export default function StudentStudyMaterialsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("newest");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [activeSubject, setActiveSubject] = useState<string>("all");

  // Single cached fetch (bounded to 100 rows); search filters client-side in
  // processedMaterials below — passing the raw search string into the hook
  // re-ran its ~10-query resolution chain on every keystroke.
  const { data: materials = [], isLoading } = useIsolatedStudyMaterials();
  const { isFeatureEnabled } = useInstitutionFeatures();

  // --- 1. EXTRACT UNIQUE SUBJECTS ---
  const uniqueSubjects = useMemo(() => {
    const subjects = new Set(
      materials.map((m) => m.subject_name || "General Resources"),
    );
    return Array.from(subjects).sort();
  }, [materials]);

  // --- 2. LOGIC: Filter -> Sort -> Group ---
  const processedMaterials = useMemo(() => {
    let result = [...materials];

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((m) => m.title.toLowerCase().includes(q));
    }

    if (activeFilter !== "all") {
      result = result.filter((m) => {
        if (activeFilter === "link")
          return (
            m.material_type !== "pdf" &&
            m.material_type !== "video" &&
            m.material_type !== "book"
          );
        return m.material_type === activeFilter;
      });
    }

    if (activeSubject !== "all") {
      result = result.filter(
        (m) => (m.subject_name || "General Resources") === activeSubject,
      );
    }

    result.sort((a, b) => {
      switch (sortBy) {
        case "newest":
          return (
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
          );
        case "oldest":
          return (
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
          );
        case "a-z":
          return a.title.localeCompare(b.title);
        case "z-a":
          return b.title.localeCompare(a.title);
        default:
          return 0;
      }
    });

    return result;
  }, [materials, searchQuery, activeFilter, sortBy, activeSubject]);

  // --- 3. Group by Subject (for display) ---
  const groupedMaterials = useMemo(() => {
    return processedMaterials.reduce(
      (acc, material) => {
        const subjectName = material.subject_name || "General Resources";
        if (!acc[subjectName]) acc[subjectName] = [];
        acc[subjectName].push(material);
        return acc;
      },
      {} as Record<string, typeof materials>,
    );
  }, [processedMaterials]);

  // The per-subject main/optional badge was removed 2026-07-30 — every
  // optional a student takes now counts as a main subject, so the label
  // carried no information.

  const handleOpenMaterial = (material: (typeof materials)[0]) => {
    const url = material.external_link || material.file_url;
    if (!url) return;

    // openExternal MUST run synchronously inside the click handler or Safari and
    // Chrome treat it as an unrequested popup and block it. The activity log
    // therefore fires after, and deliberately does not block or fail the open.
    openExternal(url);

    // Marks the day active for the streak. The material opens in a new tab at a
    // storage/external URL where none of our JS runs, so there is no dwell
    // measurement here yet — the open alone qualifies. When an in-app viewer
    // lands, this call gains a dwell argument and the RPC starts rejecting
    // short opens; no other part of the streak chain has to change.
    // Generated types lag this new RPC — narrow structural cast per §5a, never
    // `as any`. Drop it at the next `supabase gen types` run.
    const activityClient = supabase as unknown as {
      rpc(
        fn: "log_study_material_open",
        args: { _material_id: string },
      ): PromiseLike<{ error: { message: string } | null }>;
    };
    void activityClient
      .rpc("log_study_material_open", { _material_id: material.id })
      .then(({ error }) => {
        // Never surface this: failing to log a streak day must not interrupt a
        // student who is trying to read something.
        if (error) console.warn("study material activity not logged", error.message);
      });
  };

  const hasActiveFilters =
    searchQuery.trim() !== "" || activeFilter !== "all" || activeSubject !== "all";
  const clearFilters = () => {
    setSearchQuery("");
    setActiveFilter("all");
    setActiveSubject("all");
  };

  const groupNames = Object.keys(groupedMaterials);

  return (
    <PageShell>
      <PageHeader
        icon={<GraduationCap className="h-5 w-5" />}
        title="Study Materials"
        subtitle="All your course resources and syllabus, in one place"
      />

      <div className="space-y-8">
        {/* Syllabus overview (optional feature). Renders nothing when the school
            has no parts, so the page is unchanged for those schools. */}
        <StudentSyllabusSegments enabled={isFeatureEnabled("syllabus_segmentation")} />

        {/* Study materials */}
        <section className="space-y-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
              <Library className="h-5 w-5" />
            </span>
            <h2 className="text-lg sm:text-xl font-semibold text-ink-900">
              Study Materials
            </h2>
          </div>

          {/* Controls — clearly scoped to the materials below */}
          <div className="surface-card frosted-shadow rounded-card p-3 sm:p-4 space-y-3">
            <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <Input
                  placeholder="Search materials..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-11 pl-9"
                />
              </div>
              <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto">
                <Select value={activeSubject} onValueChange={setActiveSubject}>
                  <SelectTrigger className="h-11 sm:w-[190px]">
                    <SelectValue placeholder="Subject" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All subjects</SelectItem>
                    {uniqueSubjects.map((subject) => (
                      <SelectItem key={subject} value={subject}>
                        {subject}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={sortBy}
                  onValueChange={(v) => setSortBy(v as SortOption)}
                >
                  <SelectTrigger className="h-11 sm:w-[150px]">
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="newest">Newest first</SelectItem>
                    <SelectItem value="oldest">Oldest first</SelectItem>
                    <SelectItem value="a-z">Title (A–Z)</SelectItem>
                    <SelectItem value="z-a">Title (Z–A)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
              {TYPE_FILTERS.map((filter) => (
                <Button
                  key={filter.id}
                  variant={activeFilter === filter.id ? "default" : "outline"}
                  size="sm"
                  onClick={() => setActiveFilter(filter.id)}
                  className="h-8 shrink-0 rounded-full text-xs font-medium"
                >
                  {filter.label}
                </Button>
              ))}
            </div>
          </div>

          {/* Content */}
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="surface-card frosted-shadow rounded-card p-4"
                >
                  <Skeleton className="mb-4 h-11 w-11 rounded-2xl" />
                  <Skeleton className="mb-2 h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))}
            </div>
          ) : groupNames.length === 0 ? (
            <div className="surface-card frosted-shadow rounded-card">
              <EmptyState
                icon={<Search className="h-7 w-7" />}
                title="No materials found"
                description={
                  hasActiveFilters
                    ? "No materials match your current search and filters."
                    : "Your teachers haven't shared any study materials yet. Check back soon."
                }
                reason={hasActiveFilters ? "noResults" : "noData"}
                action={
                  hasActiveFilters
                    ? { label: "Clear filters", onClick: clearFilters }
                    : undefined
                }
              />
            </div>
          ) : (
            <div className="space-y-8">
              {groupNames.map((subjectName) => {
                const subjectMaterials = groupedMaterials[subjectName];
                return (
                  <div key={subjectName} className="space-y-3">
                    {/* Subject sub-header */}
                    <div className="flex items-center gap-2.5">
                      <span className="h-5 w-1.5 rounded-full bg-brand-primary" />
                      <h3 className="text-base font-semibold text-ink-900">
                        {subjectName}
                      </h3>
                      <Badge
                        variant="secondary"
                        className="rounded-full px-2 font-normal text-ink-600"
                      >
                        {subjectMaterials.length}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {subjectMaterials.map((material) => {
                        const tone = TONES[materialTone(material.material_type)];
                        return (
                          <div
                            key={material.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleOpenMaterial(material)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleOpenMaterial(material);
                              }
                            }}
                            className="group surface-card frosted-shadow rounded-card flex cursor-pointer flex-col gap-3 p-4 transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-card-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span
                                className={cn(
                                  "inline-flex h-11 w-11 items-center justify-center rounded-2xl",
                                  tone.bg,
                                  tone.fg,
                                )}
                              >
                                {materialIcon(material.material_type)}
                              </span>
                              <Badge
                                variant="outline"
                                className="border-surface-stroke text-[10px] font-semibold uppercase tracking-wide text-ink-500"
                              >
                                {material.material_type}
                              </Badge>
                            </div>

                            <div className="min-w-0 flex-1">
                              <h4 className="line-clamp-2 font-semibold leading-snug text-ink-900 transition-colors group-hover:text-brand-primary">
                                {material.title}
                              </h4>
                              {material.publisher && (
                                <p className="mt-1 text-xs text-ink-500">
                                  {material.publisher}
                                </p>
                              )}
                              {material.description && (
                                <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-ink-600">
                                  {material.description}
                                </p>
                              )}
                            </div>

                            <div className="flex items-center justify-between border-t border-surface-stroke pt-3">
                              <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
                                <Calendar className="h-3.5 w-3.5" />
                                {new Date(material.created_at).toLocaleDateString(
                                  undefined,
                                  { month: "short", day: "numeric" },
                                )}
                              </span>
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-brand-primary">
                                Open
                                <ExternalLink className="h-3.5 w-3.5" />
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
