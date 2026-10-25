import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AlertTriangle, BookOpen, ChevronDown, ChevronRight, Info, Search, Users } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/surfaces";
import { ClassConfig } from "./types";

interface ClassStructureStepProps {
  academicYear: string;
  classes: ClassConfig[];
  onAcademicYearChange: (year: string) => void;
  onClassesChange: (classes: ClassConfig[]) => void;
}

interface GradeLevel {
  id: string;
  grade_name: string;
}

interface UniversalSubject {
  id: string;
  name: string;
  category: string | null;
  grade_level_id: string | null;
}

interface SubjectGroup {
  key: string;
  label: string;
  subjects: UniversalSubject[];
}

// Grades are now fetched dynamically from the database (grade_levels table)

const DEFAULT_SECTIONS = ["A", "B", "C", "D", "E", "F"];

// Core subjects matched by name (codes are NULL in database)
const CORE_SUBJECT_NAMES = ["english", "hindi", "mathematics", "math", "science", "social studies", "social science", "environmental", "evs"];

const UNTAGGED_GROUP_LABEL = "Not tagged to a grade";

// Global reference tables. ~154 global universal_subjects rows and ~26
// grade_levels rows in prod, curated by SALCI, never written by institutions.
// The explicit .range() exists because PostgREST caps silently at 1000 and a
// silent truncation here is invisible: a subject simply stops being offered.
const GRADE_LEVEL_FETCH_LIMIT = 200;
const GLOBAL_SUBJECT_FETCH_LIMIT = 500;

// Show the search box once the pool stops being scannable at a glance.
const SEARCH_VISIBILITY_THRESHOLD = 12;

// Helper to check if a subject is a core subject by name
const isCoreSubject = (subjectName: string): boolean => {
  const lowerName = subjectName.toLowerCase();
  return CORE_SUBJECT_NAMES.some(coreName => lowerName.includes(coreName));
};

const normalizeSubjectName = (name: string): string => name.trim().toLowerCase();

const getCurrentAcademicYear = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  if (month >= 3) {
    return `${year}-${(year + 1).toString().slice(-2)}`;
  }
  return `${year - 1}-${year.toString().slice(-2)}`;
};

export function ClassStructureStep({
  academicYear,
  classes,
  onAcademicYearChange,
  onClassesChange,
}: ClassStructureStepProps) {
  const [expandedClasses, setExpandedClasses] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  // Per-grade "browse the full global subject list" toggle. Lives here, not in a
  // child, because CollapsibleContent unmounts when a grade is collapsed and the
  // whole expanded block is behind `isSelected && isExpanded`. Local state there
  // would reset on every collapse.
  const [showAllSubjectsFor, setShowAllSubjectsFor] = useState<Set<string>>(new Set());
  const [subjectFilters, setSubjectFilters] = useState<Record<string, string>>({});

  // Fetch grade levels for mapping
  const {
    data: gradeLevels = [],
    isLoading: gradeLevelsLoading,
    isError: gradeLevelsError,
    refetch: refetchGradeLevels,
  } = useQuery({
    queryKey: ['grade-levels-wizard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('grade_levels')
        .select('id, grade_name')
        .order('display_order')
        .range(0, GRADE_LEVEL_FETCH_LIMIT - 1);

      if (error) throw error;
      return data as GradeLevel[];
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  // Fetch universal subjects with grade_level_id
  const {
    data: subjects = [],
    isLoading: subjectsLoading,
    isError: subjectsError,
    refetch: refetchSubjects,
  } = useQuery({
    queryKey: ['universal-subjects-wizard'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('universal_subjects')
        .select('id, name, category, grade_level_id')
        .is('institution_id', null)
        .order('name')
        .range(0, GLOBAL_SUBJECT_FETCH_LIMIT - 1);

      if (error) throw error;
      if (data.length === GLOBAL_SUBJECT_FETCH_LIMIT) {
        console.warn('[ClassStructureStep] global subject list hit the fetch limit; raise GLOBAL_SUBJECT_FETCH_LIMIT');
      }
      return data as UniversalSubject[];
    },
    staleTime: 30 * 60_000,
    gcTime: 60 * 60_000,
    refetchOnWindowFocus: false,
  });

  // grade_level_id -> grade_name, for labelling out-of-pool subjects.
  const gradeLevelIdToName = useMemo(() => {
    const m = new Map<string, string>();
    gradeLevels.forEach(gl => m.set(gl.id, gl.grade_name));
    return m;
  }, [gradeLevels]);

  // id -> subject row, for resolving already-selected ids in O(1).
  const subjectById = useMemo(() => {
    const m = new Map<string, UniversalSubject>();
    subjects.forEach(s => m.set(s.id, s));
    return m;
  }, [subjects]);

  // grade_name -> subjects tagged to ANY grade_levels row carrying that name.
  // The union matters: prod has TWO rows named "UKG" (the canonical one with
  // class_groups + syllabus_topics, and a stray with none), each owning its own
  // "English". The old Record<string,string> map was last-write-wins, so which
  // UKG English the wizard offered depended on row order.
  //
  // Walking gradeLevels in display_order (rather than iterating `subjects`)
  // makes the same-name collapse deterministic: the earlier, canonical grade row
  // wins, instead of whichever twin PostgREST happened to return first. Two rows
  // sharing a name under one grade are a data duplicate; offering both would put
  // two identical "English" chips on screen and write two English subjects into
  // the new institution.
  const subjectsByGradeName = useMemo(() => {
    const byGradeLevelId = new Map<string, UniversalSubject[]>();
    subjects.forEach(s => {
      if (!s.grade_level_id) return;                        // 13 global rows have NULL
      const arr = byGradeLevelId.get(s.grade_level_id);
      if (arr) arr.push(s);
      else byGradeLevelId.set(s.grade_level_id, [s]);
    });

    const byName = new Map<string, UniversalSubject[]>();
    const takenNames = new Map<string, Set<string>>();
    gradeLevels.forEach(gl => {
      const rows = byGradeLevelId.get(gl.id);
      if (!rows?.length) return;
      const bucket = byName.get(gl.grade_name) ?? [];
      const taken = takenNames.get(gl.grade_name) ?? new Set<string>();
      rows.forEach(s => {
        const key = normalizeSubjectName(s.name);
        if (taken.has(key)) return;
        taken.add(key);
        bucket.push(s);
      });
      byName.set(gl.grade_name, bucket);
      takenNames.set(gl.grade_name, taken);
    });
    return byName;
  }, [subjects, gradeLevels]);

  // Drop-in replacement for the old helper: same signature, same [] for an
  // unknown grade, so every existing call site keeps working unchanged.
  const getSubjectsForGrade = (gradeName: string): UniversalSubject[] =>
    subjectsByGradeName.get(gradeName) ?? [];

  // One row per distinct grade NAME, not per grade_levels row. Prod has two rows
  // both named "UKG" (grade_number -1 canonical, 0 stray), and ClassConfig.name
  // is the identity key for everything downstream: selection, per-grade state,
  // ReviewStep's React key, and the edge function's merge. Rendering both rows
  // gives two identical checkboxes that tick and untick together (because
  // selectedGrades matches by name), an inflated class count, and a duplicate
  // React key in ReviewStep. subjectsByGradeName already pools BOTH rows'
  // subjects under the one name and dedupes them, so the single row shown here
  // offers the union and loses nothing.
  const distinctGradeNames = useMemo(() => {
    const seen = new Set<string>();
    return gradeLevels.filter(gl => {
      if (seen.has(gl.grade_name)) return false;
      seen.add(gl.grade_name);
      return true;
    });
  }, [gradeLevels]);

  // INVARIANT (do not "optimise" away): the returned array ALWAYS contains every
  // resolvable id in `selectedIds`. A pool that is a plain filter lets an
  // out-of-pool pick render nowhere, which makes it impossible to deselect: the
  // subject stays invisibly attached to the grade, keeps canProceed() satisfied
  // on a grade the admin believes is empty, and ships to subject_class_mappings.
  // It also lets the "X of Y" badge show a numerator above its denominator.
  const buildVisiblePool = (
    grade: string,
    selectedIds: string[],
    showAll: boolean,
  ): UniversalSubject[] => {
    const base = showAll ? subjects : getSubjectsForGrade(grade);
    const seen = new Set(base.map(s => s.id));
    const extras: UniversalSubject[] = [];
    for (const id of selectedIds) {
      if (seen.has(id)) continue;
      const row = subjectById.get(id);
      if (!row) continue;                 // orphan, surfaced separately
      extras.push(row);
      seen.add(id);
    }
    return extras.length > 0 ? [...base, ...extras] : base;
  };

  // Groups by grade NAME (not grade_level_id) so twin grade rows collapse into
  // one group instead of two adjacent identically-labelled headers.
  const buildSubjectGroups = (
    grade: string,
    pool: UniversalSubject[],
    selectedSet: Set<string>,
  ): SubjectGroup[] => {
    const byLabel = new Map<string, UniversalSubject[]>();
    for (const s of pool) {
      const label = s.grade_level_id
        ? gradeLevelIdToName.get(s.grade_level_id) ?? UNTAGGED_GROUP_LABEL
        : UNTAGGED_GROUP_LABEL;
      const arr = byLabel.get(label);
      if (arr) arr.push(s);
      else byLabel.set(label, [s]);
    }

    // Within one grade label, two rows sharing a name are a data duplicate (the
    // UKG "English" pair). Collapse them, but NEVER drop a selected row: keeping
    // every selected duplicate is what preserves the superset invariant.
    const dedupe = (rows: UniversalSubject[]): UniversalSubject[] => {
      const buckets = new Map<string, UniversalSubject[]>();
      for (const r of rows) {
        const k = normalizeSubjectName(r.name);
        const b = buckets.get(k);
        if (b) b.push(r);
        else buckets.set(k, [r]);
      }
      const out: UniversalSubject[] = [];
      buckets.forEach(bucket => {
        const sel = bucket.filter(r => selectedSet.has(r.id));
        if (sel.length > 0) out.push(...sel);
        else out.push(bucket[0]);
      });
      return out;
    };

    const groups: SubjectGroup[] = [];
    // 1. this grade first
    const own = byLabel.get(grade);
    if (own?.length) groups.push({ key: grade, label: grade, subjects: dedupe(own) });
    // 2. every other grade in grade_levels display_order (the query already orders)
    for (const gl of gradeLevels) {
      if (gl.grade_name === grade) continue;
      if (groups.some(g => g.key === gl.grade_name)) continue;   // duplicate name rows
      const rows = byLabel.get(gl.grade_name);
      if (rows?.length) {
        groups.push({ key: gl.grade_name, label: gl.grade_name, subjects: dedupe(rows) });
      }
    }
    // 3. the grade-less rows last
    const untagged = byLabel.get(UNTAGGED_GROUP_LABEL);
    if (untagged?.length) {
      groups.push({ key: "__untagged", label: UNTAGGED_GROUP_LABEL, subjects: dedupe(untagged) });
    }
    return groups;
  };

  // A bulk helper operates on the grade-tagged dimension. It must never silently
  // drop a pick made from outside that pool, or "Apply Core Subjects to All"
  // resets every pre-primary grade to the dead end the admin just escaped.
  const withOutOfPoolPreserved = (
    grade: string,
    existingIds: string[],
    nextTaggedIds: string[],
  ): string[] => {
    const taggedIds = new Set(getSubjectsForGrade(grade).map(s => s.id));
    const keep = existingIds.filter(id => !taggedIds.has(id));
    const next = new Set(nextTaggedIds);
    return [...nextTaggedIds, ...keep.filter(id => !next.has(id))];
  };

  // Core subjects for a grade, falling back to the whole tagged pool when the
  // name match finds nothing.
  const deriveCoreSubjectIds = (grade: string): string[] => {
    const gradeSubjects = getSubjectsForGrade(grade);
    const coreIds = gradeSubjects.filter(s => isCoreSubject(s.name)).map(s => s.id);
    if (coreIds.length === 0 && gradeSubjects.length > 0) {
      return gradeSubjects.map(s => s.id);
    }
    return coreIds;
  };

  const selectedGrades = classes.map(c => c.name);

  const toggleGrade = (grade: string) => {
    if (selectedGrades.includes(grade)) {
      onClassesChange(classes.filter(c => c.name !== grade));
      setExpandedClasses(prev => {
        const next = new Set(prev);
        next.delete(grade);
        return next;
      });
      setShowAllSubjectsFor(prev => { const n = new Set(prev); n.delete(grade); return n; });
      setSubjectFilters(prev => { const n = { ...prev }; delete n[grade]; return n; });
    } else {
      const gradeSubjects = getSubjectsForGrade(grade);
      const subjectIds = deriveCoreSubjectIds(grade);

      onClassesChange([
        ...classes,
        { name: grade, sections: DEFAULT_SECTIONS.slice(0, 4), subjectIds }
      ]);
      setExpandedClasses(prev => new Set(prev).add(grade));

      // A grade with zero tagged subjects is added with an empty selection and
      // immediately blocks Next. Open the Subjects panel so the escape hatch is
      // visible without a second click.
      if (gradeSubjects.length === 0) {
        setExpandedSections(prev => new Set(prev).add(`${grade}-subjects`));
      }
    }
  };

  const toggleClassExpanded = (grade: string) => {
    setExpandedClasses(prev => {
      const next = new Set(prev);
      if (next.has(grade)) {
        next.delete(grade);
      } else {
        next.add(grade);
      }
      return next;
    });
  };

  const toggleSectionsExpanded = (grade: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      const key = `${grade}-sections`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleSubjectsExpanded = (grade: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      const key = `${grade}-subjects`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Clearing the filter here is REQUIRED, not tidiness. The search input is
  // rendered conditionally, and in practice only in show-all mode (no grade has
  // more than 11 tagged subjects). Leaving a query behind when the input
  // unmounts leaves an invisible filter narrowing the list with no on-screen
  // way to clear it, so the admin sees 1 of 8 subjects and no explanation.
  // `showSearch` also keeps the input mounted while a query is live, so the two
  // guards cover each other.
  const toggleShowAllSubjects = (grade: string) => {
    let turnedOff = false;
    setShowAllSubjectsFor(prev => {
      const next = new Set(prev);
      if (next.has(grade)) {
        next.delete(grade);
        turnedOff = true;
      } else {
        next.add(grade);
      }
      return next;
    });
    // Clear ONLY when leaving show-all. Clearing on the way IN would wipe a query
    // the admin is deliberately widening ("phy" found nothing in the tagged pool,
    // so they flip the switch to search all subjects) and dump the full list on
    // them. On the way out the pool shrinks, so a leftover query could hide
    // everything, and `showSearch` alone would be doing all the work.
    if (turnedOff) {
      setSubjectFilters(prev => (prev[grade] ? { ...prev, [grade]: "" } : prev));
    }
  };

  const setSubjectFilter = (grade: string, value: string) => {
    setSubjectFilters(prev => ({ ...prev, [grade]: value }));
  };

  const toggleSection = (grade: string, section: string) => {
    const classConfig = classes.find(c => c.name === grade);
    if (!classConfig) return;

    const newSections = classConfig.sections.includes(section)
      ? classConfig.sections.filter(s => s !== section)
      : [...classConfig.sections, section];

    onClassesChange(
      classes.map(c => c.name === grade ? { ...c, sections: newSections } : c)
    );
  };

  const toggleSubject = (grade: string, subjectId: string) => {
    const classConfig = classes.find(c => c.name === grade);
    if (!classConfig) return;

    const newSubjectIds = classConfig.subjectIds.includes(subjectId)
      ? classConfig.subjectIds.filter(id => id !== subjectId)
      : [...classConfig.subjectIds, subjectId];

    onClassesChange(
      classes.map(c => c.name === grade ? { ...c, subjectIds: newSubjectIds } : c)
    );
  };

  // Distinct by NAME, not by grade_levels row. grade_levels has two rows both
  // named "UKG", and ClassConfig.name is the identity key everywhere downstream
  // (selection, per-grade state, ReviewStep's React key, the edge function's
  // merge). Mapping rows 1:1 would emit two "UKG" entries: the summary would
  // claim 27 classes for 26 grades, ReviewStep would render a duplicate React
  // key, and unticking one UKG would silently drop both.
  const selectAllGrades = () => {
    const next: ClassConfig[] = [];
    for (const gradeLevel of distinctGradeNames) {
      const name = gradeLevel.grade_name;
      next.push({
        name,
        sections: DEFAULT_SECTIONS.slice(0, 4),
        subjectIds: deriveCoreSubjectIds(name),
      });
    }
    onClassesChange(next);
  };

  const clearAllGrades = () => {
    onClassesChange([]);
    setExpandedClasses(new Set());
    setShowAllSubjectsFor(new Set());
    setSubjectFilters({});
  };

  const applyCoreSubjectsToAll = () => {
    onClassesChange(
      classes.map(c => ({
        ...c,
        subjectIds: withOutOfPoolPreserved(c.name, c.subjectIds, deriveCoreSubjectIds(c.name)),
      }))
    );
  };

  const applyAllSubjectsToAll = () => {
    onClassesChange(
      classes.map(c => ({
        ...c,
        subjectIds: withOutOfPoolPreserved(
          c.name,
          c.subjectIds,
          getSubjectsForGrade(c.name).map(s => s.id),
        ),
      }))
    );
  };

  const selectCoreSubjectsForClass = (grade: string) => {
    const coreIds = deriveCoreSubjectIds(grade);
    onClassesChange(
      classes.map(c => c.name === grade
        ? { ...c, subjectIds: withOutOfPoolPreserved(grade, c.subjectIds, coreIds) }
        : c)
    );
  };

  const selectAllSubjectsForClass = (grade: string) => {
    const taggedIds = getSubjectsForGrade(grade).map(s => s.id);
    onClassesChange(
      classes.map(c => c.name === grade
        ? { ...c, subjectIds: withOutOfPoolPreserved(grade, c.subjectIds, taggedIds) }
        : c)
    );
  };

  const clearSubjectsForClass = (grade: string) => {
    onClassesChange(
      classes.map(c => c.name === grade ? { ...c, subjectIds: [] } : c)
    );
  };

  const getClassConfig = (grade: string) => {
    return classes.find(c => c.name === grade);
  };

  const getClassTotal = (grade: string) => {
    const config = getClassConfig(grade);
    if (!config) return 0;
    return config.sections.length + config.subjectIds.length;
  };

  const academicYears = [
    getCurrentAcademicYear(),
    `${parseInt(getCurrentAcademicYear().split('-')[0]) + 1}-${parseInt(getCurrentAcademicYear().split('-')[1]) + 1}`,
  ];

  /**
   * The whole Subjects collapsible for one grade. Written as a render helper so
   * the header badge and the body share one derivation pass, and so the pool
   * maths only runs for grades that are actually expanded.
   */
  const renderSubjectsSection = (gradeLevel: GradeLevel, classConfig: ClassConfig) => {
    const grade = gradeLevel.grade_name;
    const isOpen = expandedSections.has(`${grade}-subjects`);

    const selectedIds = classConfig.subjectIds;
    const selectedSet = new Set(selectedIds);
    const showAll = showAllSubjectsFor.has(grade);
    const taggedPool = getSubjectsForGrade(grade);
    const headerPool = buildVisiblePool(grade, selectedIds, false);
    const visiblePool = buildVisiblePool(grade, selectedIds, showAll);
    const resolvedSelectedCount = selectedIds.reduce(
      (n, id) => (subjectById.has(id) ? n + 1 : n), 0);
    const orphanCount = selectedIds.length - resolvedSelectedCount;

    // Distinct subject ids that normalise to the SAME name. Computed across the
    // whole selection, not per grade group, because that is where the collision
    // actually happens (see the notice at the bottom of this panel).
    const duplicateNames = (() => {
      const byName = new Map<string, string>();
      const dupes = new Set<string>();
      for (const id of selectedIds) {
        const row = subjectById.get(id);
        if (!row) continue;
        const key = normalizeSubjectName(row.name);
        const first = byName.get(key);
        if (first === undefined) byName.set(key, row.name);
        else dupes.add(first);
      }
      return [...dupes];
    })();

    const query = (subjectFilters[grade] ?? "").trim().toLowerCase();
    const matches = (s: UniversalSubject) => {
      if (!query) return true;
      if (s.name.toLowerCase().includes(query)) return true;
      const label = s.grade_level_id ? gradeLevelIdToName.get(s.grade_level_id) : undefined;
      return !!label && label.toLowerCase().includes(query);   // "class 3" finds that grade's set
    };
    const filteredPool = query ? visiblePool.filter(matches) : visiblePool;
    const groups = buildSubjectGroups(grade, filteredPool, selectedSet);
    const visibleSelectedCount = filteredPool.reduce(
      (n, s) => (selectedSet.has(s.id) ? n + 1 : n), 0);
    const hiddenSelectedCount = resolvedSelectedCount - visibleSelectedCount;
    // `query.length > 0` keeps the input mounted whenever a filter is actually
    // narrowing the list, so a live filter always has a visible way to clear it.
    const showSearch =
      showAll || visiblePool.length > SEARCH_VISIBILITY_THRESHOLD || query.length > 0;
    const showGroupHeaders = groups.length > 1;

    return (
      <Collapsible open={isOpen} onOpenChange={() => toggleSubjectsExpanded(grade)}>
        <CollapsibleTrigger className="flex items-center gap-2 w-full text-left p-2 rounded hover:bg-muted/50">
          {isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Subjects</span>
          {resolvedSelectedCount === 0 ? (
            <Badge variant="outline" className="ml-auto border-destructive/40 text-destructive">
              No subjects yet
            </Badge>
          ) : (
            <Badge variant="outline" className="ml-auto">
              {resolvedSelectedCount} of {headerPool.length}
            </Badge>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 pl-4 sm:pl-8 space-y-3">
          {/* Mode row: shown when there is a tagged pool to switch away from,
              or when the user is already in all-subjects mode and needs a way back. */}
          {(taggedPool.length > 0 || showAll) && (
            <div className="flex flex-wrap items-center gap-3">
              <Switch
                id={`show-all-subjects-${gradeLevel.id}`}
                checked={showAll}
                onCheckedChange={() => toggleShowAllSubjects(grade)}
              />
              <Label
                htmlFor={`show-all-subjects-${gradeLevel.id}`}
                className="text-xs font-medium text-ink-700"
              >
                Show all subjects
              </Label>
              <span className="text-xs text-ink-500">
                {showAll
                  ? `Showing all ${subjects.length} subjects, including other grades.`
                  : `Showing the ${taggedPool.length} subjects tagged to ${grade}.`}
              </span>
            </div>
          )}

          {/* Dead-end replacement. Never a terminal message: the way forward is here. */}
          {taggedPool.length === 0 && !showAll && (
            <div className="rounded-lg border border-surface-stroke bg-muted/40 p-4 space-y-3">
              <div className="flex items-start gap-3">
                <Info className="h-4 w-4 shrink-0 text-brand-primary" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-ink-900">
                    No subjects are tagged to {grade} yet.
                  </p>
                  <p className="text-xs text-ink-600">
                    Pick from the full list of {subjects.length} subjects instead. Your choice
                    applies to {grade} only, and you can change it later in the school portal.
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => toggleShowAllSubjects(grade)}
              >
                Show all subjects
              </Button>
            </div>
          )}

          {/* Quick actions: outside the zero-subjects conditional so Clear is
              always reachable. Clear is the only escape for an orphaned id. */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              disabled={taggedPool.length === 0}
              onClick={() => selectCoreSubjectsForClass(grade)}
            >
              Select Core
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              disabled={taggedPool.length === 0}
              onClick={() => selectAllSubjectsForClass(grade)}
            >
              {showAll ? "Select All Tagged" : "Select All"}
            </Button>
            <Button
              variant="ghost" size="sm" className="h-7 text-xs"
              disabled={selectedIds.length === 0}
              onClick={() => clearSubjectsForClass(grade)}
            >
              Clear
            </Button>
          </div>

          {showSearch && (
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-400"
                aria-hidden="true"
              />
              <Input
                value={subjectFilters[grade] ?? ""}
                onChange={e => setSubjectFilter(grade, e.target.value)}
                placeholder="Search subjects"
                aria-label={`Search subjects for ${grade}`}
                className="h-8 pl-8 text-xs"
              />
            </div>
          )}

          {/* Bounded scroll region. Plain div with a length-unit max-height, NOT a
              nested Radix ScrollArea: DialogContent already wraps every child in
              one, and a second h-full viewport collapses to zero height and takes
              the dialog's own scrolling with it. overscroll-contain stops the
              wheel from jumping the dialog when this list bottoms out. */}
          <div className="max-h-64 overflow-y-auto overscroll-contain pr-2">
            {groups.length === 0 && query.length > 0 ? (
              // Gated on an ACTIVE query. An empty pool with no search is the
              // "nothing is tagged to this grade yet" case, which the info card
              // above already explains: saying "no subjects match your search"
              // there contradicts it and offers a Clear filter button that does
              // nothing. That fires on the first click for Pre Nursery, Nursery
              // and LKG, the exact grades this whole change exists to unblock.
              <div className="py-4 text-center space-y-2">
                <p className="text-sm text-ink-600">No subjects match your search.</p>
                <Button
                  variant="ghost" size="sm" className="h-7 text-xs"
                  onClick={() => setSubjectFilter(grade, "")}
                >
                  Clear filter
                </Button>
              </div>
            ) : groups.length === 0 ? null : (
              <div className="space-y-3">
                {groups.map(group => (
                  <div key={group.key} className="space-y-2">
                    {showGroupHeaders && (
                      <p className="eyebrow">
                        {group.label}
                        {group.label === grade ? " (this grade)" : ""}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {group.subjects.map(subject => {
                        const isPicked = selectedSet.has(subject.id);
                        return (
                          <Button
                            key={subject.id}
                            type="button"
                            variant={isPicked ? "default" : "outline"}
                            size="sm"
                            aria-pressed={isPicked}
                            className="h-7 rounded-full px-3 text-xs font-normal"
                            onClick={() => toggleSubject(grade, subject.id)}
                          >
                            {subject.name}
                          </Button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {hiddenSelectedCount > 0 && (
            <p className="text-xs text-ink-500">
              {hiddenSelectedCount} selected {hiddenSelectedCount === 1 ? "subject is" : "subjects are"} hidden by this search.{" "}
              <Button
                variant="link" size="sm"
                className="h-auto p-0 text-xs align-baseline"
                onClick={() => setSubjectFilter(grade, "")}
              >
                Clear filter
              </Button>
            </p>
          )}

          {orphanCount > 0 && (
            <p className="text-xs text-destructive">
              {orphanCount} previously selected {orphanCount === 1 ? "subject is" : "subjects are"} no longer available. Use Clear and pick again.
            </p>
          )}

          {/* Same-name collision across grade groups. The per-group dedupe in
              buildSubjectGroups only collapses twins INSIDE one grade label, so
              picking "English" from the Class 3 group while this grade's own
              "English" is already selected yields two distinct subject ids with
              one name. Both survive the edge function (it dedupes by uuid) and
              land in subject_class_group_mappings, so the new school gets two
              subjects called "English" on this class, which then propagate to
              timetable slots, teacher assignments and question-bank scope.
              Named and actionable rather than silently swapped: which of the two
              the admin wants is genuinely ambiguous. */}
          {duplicateNames.length > 0 && (
            <p className="text-xs text-destructive">
              {duplicateNames.join(", ")} {duplicateNames.length === 1 ? "is" : "are"} selected more than once, from different grades. Deselect the extra {duplicateNames.length === 1 ? "one" : "ones"} or this class will be created with duplicate subjects.
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  };

  // Wait for both grade levels AND subjects to load before allowing interaction
  if (subjectsLoading || gradeLevelsLoading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Error state BEFORE any empty state: a failed fetch leaves both arrays empty
  // and would otherwise render as "no grades" plus the very dead-end copy this
  // screen exists to remove, with a completely different cause.
  if (gradeLevelsError || subjectsError) {
    return (
      <Card>
        <CardContent className="p-6">
          <EmptyState
            icon={<AlertTriangle className="h-7 w-7" />}
            reason="error"
            title="Couldn't load the class structure options"
            description="The grade and subject lists are unavailable right now. Try again, or close the wizard and reopen it."
            action={{
              label: "Try again",
              onClick: () => { void refetchGradeLevels(); void refetchSubjects(); },
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2">
          <BookOpen className="h-5 w-5" />
          Class Structure
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Academic Year */}
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-muted-foreground">Academic Year:</span>
          <Select value={academicYear} onValueChange={onAcademicYearChange}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Select year" />
            </SelectTrigger>
            <SelectContent>
              {academicYears.map(year => (
                <SelectItem key={year} value={year}>{year}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={selectAllGrades}>
            Select All Grades
          </Button>
          <Button variant="outline" size="sm" onClick={clearAllGrades}>
            Clear All
          </Button>
          {classes.length > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={applyCoreSubjectsToAll}>
                Apply Core Subjects to All
              </Button>
              <Button variant="outline" size="sm" onClick={applyAllSubjectsToAll}>
                Apply All Subjects to All
              </Button>
            </>
          )}
        </div>

        {/* Grade List */}
        <div className="space-y-2">
          {distinctGradeNames.map(gradeLevel => {
            const grade = gradeLevel.grade_name;
            const isSelected = selectedGrades.includes(grade);
            const isExpanded = expandedClasses.has(grade);
            const classConfig = getClassConfig(grade);
            const totalCount = getClassTotal(grade);

            return (
              <div key={gradeLevel.id} className="border rounded-lg overflow-hidden">
                {/* Grade Header */}
                <div
                  className={`flex items-center justify-between p-3 cursor-pointer transition-colors ${
                    isSelected ? 'bg-primary/5' : 'bg-muted/30 hover:bg-muted/50'
                  }`}
                  onClick={() => isSelected && toggleClassExpanded(grade)}
                >
                  <div className="flex items-center gap-3">
                    {isSelected && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleClassExpanded(grade); }}
                        className="p-0.5 hover:bg-muted rounded"
                      >
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </button>
                    )}
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleGrade(grade)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span className="font-medium">{grade}</span>
                  </div>
                  {isSelected && (
                    <Badge variant="secondary" className="ml-auto">
                      {totalCount}
                    </Badge>
                  )}
                </div>

                {/* Expanded Content */}
                {isSelected && isExpanded && classConfig && (
                  <div className="border-t bg-background p-3 space-y-3">
                    {/* Sections */}
                    <Collapsible
                      open={expandedSections.has(`${grade}-sections`)}
                      onOpenChange={() => toggleSectionsExpanded(grade)}
                    >
                      <CollapsibleTrigger className="flex items-center gap-2 w-full text-left p-2 rounded hover:bg-muted/50">
                        {expandedSections.has(`${grade}-sections`) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        <Users className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm font-medium">Sections</span>
                        <Badge variant="outline" className="ml-auto">
                          {classConfig.sections.length} of {DEFAULT_SECTIONS.length}
                        </Badge>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="pt-2 pl-4 sm:pl-8">
                        <div className="flex flex-wrap gap-2">
                          {DEFAULT_SECTIONS.map(section => (
                            <Badge
                              key={section}
                              variant={classConfig.sections.includes(section) ? "default" : "outline"}
                              className="cursor-pointer transition-colors"
                              onClick={() => toggleSection(grade, section)}
                            >
                              Section {section}
                            </Badge>
                          ))}
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Subjects */}
                    {renderSubjectsSection(gradeLevel, classConfig)}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Summary */}
        {classes.length > 0 && (
          <div className="pt-4 border-t space-y-2">
            <p className="text-sm text-muted-foreground">
              <strong>{classes.length}</strong> classes selected with{' '}
              <strong>{classes.reduce((sum, c) => sum + c.sections.length, 0)}</strong> total sections and{' '}
              <strong>{classes.reduce((sum, c) => sum + c.subjectIds.length, 0)}</strong> subject assignments
            </p>

            {/* Validation Messages */}
            {(() => {
              const incompleteClasses = classes.filter(c => c.sections.length === 0 || c.subjectIds.length === 0);
              if (incompleteClasses.length > 0) {
                return (
                  <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                    <p className="flex items-center gap-2 text-sm font-medium text-destructive mb-1">
                      <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                      Complete these classes to proceed:
                    </p>
                    <ul className="text-sm text-destructive/80 list-disc list-inside space-y-1">
                      {incompleteClasses.map(c => {
                        const issues = [];
                        if (c.sections.length === 0) issues.push("needs sections");
                        if (c.subjectIds.length === 0) issues.push("needs subjects");
                        return (
                          <li key={c.name}>
                            <strong>{c.name}</strong>: {issues.join(" and ")}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              }
              return (
                <div className="bg-green-500/10 border border-green-500/20 rounded-md p-3">
                  <p className="text-sm font-medium text-green-600">
                    ✓ All classes are complete. You can proceed to the next step.
                  </p>
                </div>
              );
            })()}

            {/* Duplicate roll-up. The per-grade notice lives inside a
                CollapsibleContent, so it unmounts the moment the panel is closed
                while the bad state survives in wizardData.classes. The bulk
                "Apply ... to All" buttons can even CREATE a duplicate with every
                panel shut. Without this roll-up, every remaining surface (the
                green banner above, canProceed, ReviewStep) affirms the config is
                fine. Non-blocking on purpose: deselecting is always available, so
                naming the classes cannot strand anyone. */}
            {(() => {
              const dupClasses = classes
                .map(c => {
                  const byName = new Map<string, string>();
                  const dupes = new Set<string>();
                  for (const id of c.subjectIds) {
                    const row = subjectById.get(id);
                    if (!row) continue;
                    const key = normalizeSubjectName(row.name);
                    const first = byName.get(key);
                    if (first === undefined) byName.set(key, row.name);
                    else dupes.add(first);
                  }
                  return { name: c.name, dupes: [...dupes] };
                })
                .filter(x => x.dupes.length > 0);

              if (dupClasses.length === 0) return null;
              return (
                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-destructive mb-1">
                    <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                    These classes have the same subject twice, from different grades:
                  </p>
                  <ul className="text-sm text-destructive/80 list-disc list-inside space-y-1">
                    {dupClasses.map(x => (
                      <li key={x.name}>
                        <strong>{x.name}</strong>: {x.dupes.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        )}

        {classes.length === 0 && (
          <div className="bg-muted/50 border border-border rounded-md p-4 text-center">
            <p className="text-sm text-muted-foreground">
              Select at least one class to continue
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
