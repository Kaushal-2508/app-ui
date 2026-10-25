import { useState, useEffect, useMemo, useRef } from "react";
import { normalizeText } from "@/lib/textNormalization";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  BookOpen,
  Search,
  Plus,
  MoreHorizontal,
  Edit,
  Trash2,
  Upload,
  Copy,
  Globe,
  Building2,
  UserRound,
  Sparkles,
  Layers,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useQuestionBank, useQuestionBankStats, useDeleteQuestionBank, useAddQuestionToBank, QuestionBankItem } from "@/hooks/useQuestionBank";
import AddQuestionToBankDialog from "@/components/admin/AddQuestionToBankDialog";
import EditQuestionBankDialog from "@/components/admin/EditQuestionBankDialog";
import { BulkUploadQuestionsDialog } from "@/components/school/BulkUploadQuestionsDialog";
import { useUserRole } from "@/hooks/useUserRole";
import { useEffectiveInstitution } from "@/hooks/useEffectiveInstitution";
import { useAuth } from "@/hooks/useAuth";
import { useTeacherAssignedSubjects } from "@/hooks/useTeacherAssignedSubjects";
import { useTeacherClasses } from "@/hooks/useTeacherClasses";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";
import { useDebounce } from "@/hooks/useDebounce";
import type { Database } from "@/integrations/supabase/types";
import { formatNumber } from "@/lib/formatNumber";
import { sortClassRows } from "@/lib/classSort";
import { translateError } from "@/lib/errorMessages";

import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { SECONDARY_PILL } from "@/components/shared/page/PageHeader";
import { StatTile, StatTileGrid, ListRow, EmptyState } from "@/components/shared/surfaces";
import { FilterRow, FilterSheet } from "@/components/shared/nav";

type DbQuestionType = Database["public"]["Enums"]["question_type"];

const PAGE_SIZE = 50;

// UI-level question-type options. Mirrors LABEL_MAP in
// src/components/exam-creation/components/QuestionTypeChip.tsx so the
// question bank speaks the same vocabulary as exam creation. Each option
// declares which DB enum value(s) it filters on so the legacy `matching`
// and the newer `match_column` enum values both surface under one
// "Match Column" chip, and the UI-only "Case Study" variant (stored as
// long_answer parent + sub_question_count) gets its own filter.
type QuestionTypeFilterOption = {
  key: string;                                 // value used in the dropdown
  label: string;                               // shown to the user
  dbTypes?: DbQuestionType[];                  // single or multiple DB enum filter
  caseStudyOnly?: boolean;                     // UI-only variant
  excludeCaseStudy?: boolean;                  // applies when filtering long_answer
};

const QUESTION_TYPE_OPTIONS: QuestionTypeFilterOption[] = [
  { key: "mcq",            label: "MCQ",            dbTypes: ["mcq"] },
  { key: "true_false",     label: "True / False",   dbTypes: ["true_false"] },
  { key: "fill_blank",     label: "Fill in Blank",  dbTypes: ["fill_blank"] },
  { key: "match_column",   label: "Match Column",   dbTypes: ["matching", "match_column"] },
  { key: "short_answer",   label: "Short Answer",   dbTypes: ["short_answer"] },
  { key: "long_answer",    label: "Long Answer",    dbTypes: ["long_answer"], excludeCaseStudy: true },
  { key: "comprehension",  label: "Comprehension",  dbTypes: ["comprehension"] },
  { key: "case_study",     label: "Case Study",     caseStudyOnly: true },
];

const QUESTION_TYPE_OPTION_BY_KEY = Object.fromEntries(
  QUESTION_TYPE_OPTIONS.map((o) => [o.key, o] as const),
) as Record<string, QuestionTypeFilterOption>;

// Map a question_bank row's stored question_type → human label for the
// list rows. `long_answer` rows that carry sub_question_count are case
// studies; bare `long_answer` rows are plain essays.
function labelForRowType(qType: string, hasSubQuestions: boolean): string {
  if (qType === "long_answer" && hasSubQuestions) return "Case Study";
  if (qType === "matching" || qType === "match_column") return "Match Column";
  if (qType === "mcq") return "MCQ";
  if (qType === "true_false") return "True / False";
  if (qType === "fill_blank") return "Fill in Blank";
  if (qType === "short_answer") return "Short Answer";
  if (qType === "long_answer") return "Long Answer";
  if (qType === "comprehension") return "Comprehension";
  if (qType === "numerical") return "Numerical";
  return qType;
}

// "mine" is the Your Questions tab (the default), "custom" is All Questions.
// "global" exists for super admins only: /admin/question-bank is the one
// screen that manages the global pool.
type BankTab = "custom" | "mine" | "global";

export default function QuestionBankPage() {
  const [activeTab, setActiveTab] = useState<BankTab>("mine");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [globalPage, setGlobalPage] = useState(1);
  const [customPage, setCustomPage] = useState(1);
  const [minePage, setMinePage] = useState(1);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<QuestionBankItem | null>(null);
  const { data: roleInfo } = useUserRole();
  const { institutionId: effectiveInstitutionId } = useEffectiveInstitution();
  const { user } = useAuth();
  const isTeacher = roleInfo?.primaryRole === "teacher";
  const { data: teacherAssignments } = useTeacherAssignedSubjects(isTeacher ? user?.id : null);
  const { data: teacherClasses } = useTeacherClasses(isTeacher ? (user?.id ?? null) : null);

  const debouncedSearch = useDebounce(search, 400);

  const isSuperAdmin = roleInfo?.isSuperAdmin;
  const canManageGlobal = isSuperAdmin;
  const canManageCustom = !!effectiveInstitutionId;

  // Reset pages when filters change
  useEffect(() => {
    setGlobalPage(1);
    setCustomPage(1);
    setMinePage(1);
  }, [debouncedSearch, typeFilter, gradeFilter, subjectFilter, topicFilter]);

  // Fetch institution-scoped classes. Also include class_group_id so the
  // subject-filter cascade can resolve a section selection up to its parent
  // class_group (the canonical scope after the §22 Phase 2 refactor).
  const { data: institutionClasses } = useQuery({
    queryKey: ["institution-classes-filter-v2", effectiveInstitutionId],
    queryFn: async () => {
      if (!effectiveInstitutionId) return [];
      const { data, error } = await supabase
        .from("classes")
        .select("id, name, section, class_group_id")
        .eq("institution_id", effectiveInstitutionId)
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return sortClassRows(data ?? [], (c) => c.name, (c) => c.section);
    },
    enabled: !!effectiveInstitutionId,
  });

  // For teachers, filter to their assigned classes only
  const availableClasses = useMemo(() => {
    if (!institutionClasses) return [];
    if (isTeacher && teacherClasses) {
      const teacherClassIds = new Set(teacherClasses.map(c => c.id));
      return institutionClasses.filter(c => teacherClassIds.has(c.id));
    }
    return institutionClasses;
  }, [institutionClasses, isTeacher, teacherClasses]);

  // Deduplicate classes by name
  const uniqueClassNames = useMemo(() => {
    const map = new Map<string, { name: string; classIds: string[] }>();
    availableClasses.forEach(c => {
      const baseName = c.name;
      if (!map.has(baseName)) {
        map.set(baseName, { name: baseName, classIds: [] });
      }
      map.get(baseName)!.classIds.push(c.id);
    });
    return Array.from(map.values());
  }, [availableClasses]);

  // Phase 3 class-groups are the parent container above per-section classes
  // (CLAUDE.md §22). The Add Question dialog writes `question_bank.class_group_id`
  // and lets the parent group supply `grade_level_id`. Each class_group row is
  // a distinct UUID — this is what lets "Class 12 Commerce" and "Class 12
  // Science - Non - Medical" show as separate options even though they share
  // grade_number=12.
  const { data: institutionClassGroups } = useInstitutionClassGroups(
    effectiveInstitutionId ?? null,
  );

  // For teachers, scope the picker to class_groups whose sections overlap
  // with their class_assignments — matches the visibility scope of other
  // class-group driven surfaces (useChapterTopics, useChaptersForExam).
  const availableClassGroupsForDialog = useMemo(() => {
    const source = (institutionClassGroups || []).filter((g) => g.is_active !== false);
    const filtered =
      isTeacher && teacherClasses
        ? (() => {
            const teacherClassIds = new Set((teacherClasses || []).map((c) => c.id));
            return source.filter((g) =>
              (g.section_ids || []).some((sid) => teacherClassIds.has(sid)),
            );
          })()
        : source;
    return filtered.map((g) => ({
      id: g.id,
      name: g.name,
      gradeLevelId: g.grade_level_id,
    }));
  }, [institutionClassGroups, isTeacher, teacherClasses]);

  // Fetch subjects scoped to institution and optionally to selected class.
  // Reads from subject_class_group_mappings (Phase 2 per §22) so each row
  // carries the class_group it belongs to — needed because the
  // 20260501150000 split migration cloned per-class_group subjects with the
  // same name + code (only the UUID differs). Dedup by universal_subjects.id
  // alone produced 4 "Accountancy" rows in the dropdown; surfacing the
  // class_group name makes them distinguishable ("Accountancy · Class 11
  // Commerce" vs "Accountancy · Class 12 Commerce") without changing the
  // underlying ids the filter uses to query question_bank.
  const selectedClassGroupIds = useMemo(() => {
    if (gradeFilter === "all") return [];
    // The class chip's value is the class display name (e.g. "Class 9 - A").
    // Resolve it back to its parent class_group_id(s) so the subject filter
    // stays consistent with the rest of the page.
    const sectionIds = uniqueClassNames.find((c) => c.name === gradeFilter)?.classIds || [];
    if (sectionIds.length === 0) return [];
    return Array.from(
      new Set(
        availableClasses
          .filter((c) => sectionIds.includes(c.id))
          .map((c) => (c as { class_group_id?: string | null }).class_group_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
  }, [gradeFilter, uniqueClassNames, availableClasses]);

  const { data: subjects } = useQuery({
    queryKey: [
      "institution-subjects-filter-v2",
      effectiveInstitutionId,
      gradeFilter,
      selectedClassGroupIds.join(","),
    ],
    queryFn: async () => {
      if (!effectiveInstitutionId) return [];

      let query = supabase
        .from("subject_class_group_mappings" as never)
        .select(
          "subject_id, class_group_id, universal_subjects!inner(id, name), class_groups!inner(id, name)",
        )
        .eq("institution_id", effectiveInstitutionId);

      if (selectedClassGroupIds.length > 0) {
        query = query.in("class_group_id", selectedClassGroupIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      type Row = {
        subject_id: string;
        class_group_id: string;
        universal_subjects: { id: string; name: string } | null;
        class_groups: { id: string; name: string } | null;
      };

      // Each row already represents a unique (subject × class_group) pair,
      // which is what we want to surface — distinct dropdown items per
      // class_group clone.
      const subjects = ((data as Row[]) || [])
        .filter((m) => m.universal_subjects && m.class_groups)
        .map((m) => ({
          id: m.universal_subjects!.id,
          name: m.universal_subjects!.name,
          classGroupId: m.class_groups!.id,
          classGroupName: m.class_groups!.name,
          label: `${m.universal_subjects!.name} · ${m.class_groups!.name}`,
        }));

      // Dedup by (subject_id, class_group_id) — one row per pairing even
      // if the source mapping table somehow produced duplicates.
      const seen = new Set<string>();
      return subjects
        .filter((s) => {
          const key = `${s.id}::${s.classGroupId}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .sort((a, b) => a.label.localeCompare(b.label));
    },
    enabled: !!effectiveInstitutionId,
  });

  // For teachers, further filter subjects
  const filteredSubjects = useMemo(() => {
    if (!subjects) return [];
    if (isTeacher && teacherAssignments) {
      return subjects.filter(s => teacherAssignments.subjectIds.includes(s.id));
    }
    return subjects;
  }, [subjects, isTeacher, teacherAssignments]);

  // Fetch topics for selected subject
  const { data: topics } = useQuery({
    queryKey: ["syllabus-topics-filter", subjectFilter],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("syllabus_topics")
        .select("id, topic_name")
        .eq("subject_id", subjectFilter)
        .order("topic_name");
      if (error) throw error;
      return data || [];
    },
    enabled: subjectFilter !== "all",
  });

  // Cascade resets
  useEffect(() => {
    setSubjectFilter("all");
    setTopicFilter("all");
  }, [gradeFilter]);

  // Build shared filters for server-side query
  const teacherSubjectScope = isTeacher && teacherAssignments?.subjectIds?.length
    ? teacherAssignments.subjectIds
    : undefined;

  // Resolve the dropdown's UI key into the DB filter shape the hook
  // understands. "Match Column" → both matching + match_column;
  // "Case Study" → long_answer parents with sub_question_count;
  // "Long Answer" → long_answer rows WITHOUT sub_question_count.
  const typeOption = typeFilter !== "all" ? QUESTION_TYPE_OPTION_BY_KEY[typeFilter] : undefined;

  const sharedFilters = {
    questionType: typeOption?.dbTypes && typeOption.dbTypes.length === 1
      ? typeOption.dbTypes[0]
      : undefined,
    questionTypes: typeOption?.dbTypes && typeOption.dbTypes.length > 1
      ? typeOption.dbTypes
      : undefined,
    caseStudyOnly: typeOption?.caseStudyOnly,
    excludeCaseStudy: typeOption?.excludeCaseStudy,
    subjectId: subjectFilter !== "all" ? subjectFilter : undefined,
    subjectIds: subjectFilter === "all" ? teacherSubjectScope : undefined,
    topicId: topicFilter !== "all" ? topicFilter : undefined,
    search: debouncedSearch || undefined,
    pageSize: PAGE_SIZE,
    // Class chip drives this — selecting "Class 1" should ALSO filter the
    // question list, not just narrow the subject dropdown. selectedClassGroupIds
    // collapses the picked class label up to its parent class_group_ids
    // (a single label like "Class 12" can map to multiple stream class_groups
    // — Commerce / Science / Humanities — so we use the multi-id .in()
    // filter on the hook).
    classGroupIds: selectedClassGroupIds.length > 0 ? selectedClassGroupIds : undefined,
    // Hide sub-questions from the list and the count. Case Study and
    // Comprehension Para each store a parent passage row plus N child
    // short_answer rows (linked via parent_question_id). The children are
    // structural — they're surfaced to the user only when the parent is
    // expanded — so listing them as standalone "questions" inflates the
    // total (749 logical questions in the AI XLSX export became 1,421
    // rows once the children were materialised) and clutters the list
    // with text fragments that read out of context.
    excludeSubQuestions: true,
  };

  const showGlobalTab = !!isSuperAdmin;
  const isGlobalTab = activeTab === "global" && showGlobalTab;
  const isMineTab = activeTab === "mine";
  const isCustomTab = !isGlobalTab && !isMineTab;

  // Your Questions: every row the viewer authored. The teacher subject scope
  // is dropped here on purpose: a teacher still owns what they wrote for a
  // subject they no longer teach.
  const mineFilters = {
    ...sharedFilters,
    subjectIds: undefined,
    institutionId: effectiveInstitutionId || undefined,
    createdBy: user?.id,
  };

  // Only the visible tab queries; each is a count=exact scan of a ~100k-row
  // table, so running all three on every filter change tripled the load.
  const globalQuery = useQuestionBank(
    { ...sharedFilters, globalOnly: true, page: globalPage },
    { enabled: isGlobalTab },
  );
  const customQuery = useQuestionBank(
    { ...sharedFilters, institutionId: effectiveInstitutionId || undefined, page: customPage },
    { enabled: isCustomTab && !!effectiveInstitutionId },
  );
  const mineQuery = useQuestionBank(
    { ...mineFilters, page: minePage },
    { enabled: isMineTab && !!user?.id },
  );

  // Bank-wide KPI aggregate (filter-aware), scoped to the active tab. Mirrors
  // the same filter fields as the list queries above so "Question Types" and
  // "Average Marks" reflect the whole pool the user can see — not the 50-row
  // page slice — and respond to the same grade/subject/topic/type/search
  // filters. See CLAUDE.md §23.1 (aggregate server-side).
  // The RPC takes a single question_types array; collapse the hook's
  // single-vs-multi split back into one list for it.
  const statsQuestionTypes = sharedFilters.questionTypes
    ?? (sharedFilters.questionType ? [sharedFilters.questionType] : undefined);
  const statsFilters = {
    questionTypes: statsQuestionTypes,
    caseStudyOnly: sharedFilters.caseStudyOnly,
    excludeCaseStudy: sharedFilters.excludeCaseStudy,
    subjectId: sharedFilters.subjectId,
    subjectIds: sharedFilters.subjectIds,
    topicId: sharedFilters.topicId,
    classGroupIds: sharedFilters.classGroupIds,
    search: sharedFilters.search,
    excludeSubQuestions: true,
  };

  const globalStats = useQuestionBankStats({
    ...statsFilters,
    globalOnly: true,
    enabled: isGlobalTab,
  });
  const customStats = useQuestionBankStats({
    ...statsFilters,
    institutionId: effectiveInstitutionId || undefined,
    enabled: isCustomTab && !!effectiveInstitutionId,
  });
  const mineStats = useQuestionBankStats({
    ...statsFilters,
    subjectIds: undefined,
    institutionId: effectiveInstitutionId || undefined,
    createdBy: user?.id,
    enabled: isMineTab && !!user?.id,
  });

  const deleteQuestion = useDeleteQuestionBank();
  const addQuestion = useAddQuestionToBank();

  const currentQuery = isGlobalTab ? globalQuery : isMineTab ? mineQuery : customQuery;
  const currentStatsQuery = isGlobalTab ? globalStats : isMineTab ? mineStats : customStats;
  const currentResult = currentQuery.data;
  const currentQuestions = currentResult?.data || [];
  const totalCount = currentResult?.count || 0;
  const currentStats = currentStatsQuery.data;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  // Your Questions opens first and its query waits for the signed-in user;
  // until then it is loading, not "no questions".
  const waitingForUser = isMineTab && !user?.id;
  const isLoading = currentQuery.isLoading || waitingForUser;
  const refetch = () => {
    void currentQuery.refetch();
    void currentStatsQuery.refetch();
  };
  // Your Questions holds the viewer's own rows, so it is manageable wherever
  // Custom is, and for a super admin with no school picked as well.
  const canManage = isGlobalTab
    ? !!canManageGlobal
    : isMineTab
      ? canManageCustom || !!isSuperAdmin
      : canManageCustom;

  const handleDelete = async (id: string) => {
    if (window.confirm("Are you sure you want to delete this question?")) {
      await deleteQuestion.mutateAsync(id);
    }
  };

  const handleEdit = (question: QuestionBankItem) => {
    setEditingQuestion(question);
    setEditDialogOpen(true);
  };

  const handleDuplicate = async (question: QuestionBankItem) => {
    await addQuestion.mutateAsync({
      institutionId: isGlobalTab ? undefined : (effectiveInstitutionId || undefined),
      questionText: `${normalizeText(question.question_text)} (Copy)`,
      questionType: question.question_type,
      options: question.options as string[] | undefined,
      correctAnswer: question.correct_answer || undefined,
      explanation: question.explanation || undefined,
      marks: question.marks,
      difficultyLevel: question.difficulty_level,
      tags: question.tags,
      subjectId: question.subject_id || undefined,
      gradeId: question.grade_level_id || undefined,
    });
  };

  // Active filter count
  const activeFilterCount =
    (gradeFilter !== "all" ? 1 : 0) +
    (subjectFilter !== "all" ? 1 : 0) +
    (typeFilter !== "all" ? 1 : 0) +
    (topicFilter !== "all" ? 1 : 0) +
    (debouncedSearch ? 1 : 0);

  const resetFilters = () => {
    setGradeFilter("all");
    setSubjectFilter("all");
    setTypeFilter("all");
    setTopicFilter("all");
    setSearch("");
  };

  const handleAddQuestion = () => setAddDialogOpen(true);

  // Ref for hidden desktop "Add Question" button
  const addBtnRef = useRef<HTMLButtonElement>(null);

  // KPI stats come from the server-side aggregate (bank-wide, filter-aware),
  // not the on-screen page slice — so "Question Types" and "Average Marks"
  // reflect the whole visible pool. Each tile loads and fails on its own
  // query (§6: a failed read must never show as 0).
  const tileSkeleton = <Skeleton className="h-8 w-20" />;
  const totalValue = isLoading
    ? tileSkeleton
    : currentQuery.isError
      ? "N/A"
      : formatNumber(totalCount);
  const statValue = (pick: (s: NonNullable<typeof currentStats>) => string) =>
    currentStatsQuery.isLoading || waitingForUser
      ? tileSkeleton
      : currentStatsQuery.isError
        ? "N/A"
        : pick(currentStats ?? { totalQuestions: 0, distinctTypes: 0, avgMarks: 0 });

  return (
    <PageShell
      fab={
        canManage ? (
          <MobileFab
            label="Add Question"
            icon={<Plus className="h-6 w-6" />}
            onClick={handleAddQuestion}
          />
        ) : undefined
      }
    >
      <PageHeader
        icon={<BookOpen className="h-5 w-5" />}
        title="Question Bank"
        subtitle="Browse and manage the question pool"
        primaryAction={
          canManage
            ? {
                label: "Add Question",
                icon: <Plus className="h-4 w-4" />,
                onClick: handleAddQuestion,
              }
            : undefined
        }
        // The dialog owns its trigger, so it sits in the extras slot (visible on
        // every breakpoint) rather than as a secondary action. One Bulk Upload
        // button on the page; the old header copy had an empty onClick.
        extras={
          canManage ? (
            <BulkUploadQuestionsDialog
              institutionId={isGlobalTab ? undefined : (effectiveInstitutionId || undefined)}
              trigger={
                <Button variant="outline" size="sm" className={SECONDARY_PILL}>
                  <Upload className="h-4 w-4 mr-1" />
                  Bulk Upload
                </Button>
              }
            />
          ) : undefined
        }
      />

      {/* Tab strip */}
      <Tabs value={activeTab} onValueChange={(tab) => { setActiveTab(tab as BankTab); }}>
        <div className="mb-4">
          <TabsList className="rounded-full">
            <TabsTrigger value="mine" className="flex items-center gap-1.5 rounded-full">
              <UserRound className="h-3.5 w-3.5" />
              Your Questions
            </TabsTrigger>
            <TabsTrigger value="custom" className="flex items-center gap-1.5 rounded-full">
              <Building2 className="h-3.5 w-3.5" />
              All Questions
            </TabsTrigger>
            {showGlobalTab && (
              <TabsTrigger value="global" className="flex items-center gap-1.5 rounded-full">
                <Globe className="h-3.5 w-3.5" />
                Global
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {/* KPI tiles */}
        <StatTileGrid mdCols={3}>
          <StatTile
            label="Total Questions"
            value={totalValue}
            icon={<BookOpen className="h-5 w-5" />}
            tone="mint"
          />
          <StatTile
            label="Question Types"
            value={statValue((s) => formatNumber(s.distinctTypes))}
            icon={<Layers className="h-5 w-5" />}
            tone="sky"
          />
          <StatTile
            label="Average Marks"
            value={statValue((s) => s.avgMarks.toFixed(1))}
            icon={<BarChart3 className="h-5 w-5" />}
            tone="peach"
          />
        </StatTileGrid>

        {/* Search + filters */}
        <div className="mt-6 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search questions..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 h-11 rounded-xl"
            />
          </div>

          <FilterRow activeCount={activeFilterCount} onClear={resetFilters}>
            {/* Class + Subject + Type + Topic all live inside the one
                FilterSheet. Class used to sit beside the trigger as its own
                pill, which read as a second, competing entry point for the
                same job and pushed the row past the design system's
                "FilterRow for <= 2 filters, FilterSheet beyond that" rule. */}
            <FilterSheet
              activeCount={
                (gradeFilter !== "all" ? 1 : 0) +
                (subjectFilter !== "all" ? 1 : 0) +
                (typeFilter !== "all" ? 1 : 0) +
                (topicFilter !== "all" ? 1 : 0)
              }
              onApply={() => {
                /* filters already applied immediately via onChange */
              }}
              onReset={() => {
                setGradeFilter("all");
                setSubjectFilter("all");
                setTypeFilter("all");
                setTopicFilter("all");
              }}
            >
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Class</label>
                <Select value={gradeFilter} onValueChange={setGradeFilter}>
                  <SelectTrigger className="w-full rounded-xl">
                    <SelectValue placeholder="All Classes" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[50vh]">
                    <SelectItem value="all">All Classes</SelectItem>
                    {uniqueClassNames.map((cls) => (
                      <SelectItem key={cls.name} value={cls.name}>
                        {cls.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Subject</label>
                <Select
                  value={subjectFilter}
                  onValueChange={(v) => {
                    setSubjectFilter(v);
                    setTopicFilter("all");
                  }}
                >
                  <SelectTrigger className="w-full rounded-xl">
                    <SelectValue placeholder="All Subjects" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Subjects</SelectItem>
                    {filteredSubjects.map((s) => (
                      <SelectItem key={`${s.id}::${(s as { classGroupId?: string }).classGroupId ?? ""}`} value={s.id}>
                        {(s as { label?: string }).label ?? s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Always shown so all four filters are visible; it needs a
                  subject first because chapters belong to one. */}
              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Chapter</label>
                <Select
                  value={topicFilter}
                  onValueChange={setTopicFilter}
                  disabled={subjectFilter === "all"}
                >
                  <SelectTrigger className="w-full rounded-xl">
                    <SelectValue placeholder="All Chapters" />
                  </SelectTrigger>
                  <SelectContent className="max-h-[50vh]">
                    <SelectItem value="all">All Chapters</SelectItem>
                    {(topics ?? []).map((t) => (
                      <SelectItem key={t.id} value={t.id}>{t.topic_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink-700 mb-1">Question Type</label>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="w-full rounded-xl">
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {QUESTION_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.key} value={opt.key}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </FilterSheet>
          </FilterRow>
        </div>

        {/* Tab content — Global (super admins only) */}
        {showGlobalTab && (
          <TabsContent value="global" className="mt-4">
            <div className="surface-card frosted-shadow rounded-2xl p-4 space-y-3">
              <h2 className="text-base font-semibold text-ink-900">Global Questions</h2>
              <p className="text-sm text-ink-500">Questions available to all institutions</p>
              <QuestionList
                questions={currentQuestions}
                isLoading={isLoading}
                error={currentQuery.error}
                onRetry={refetch}
                canManage={!!canManageGlobal}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
              />
              <PaginationBar
                page={globalPage}
                totalPages={totalPages}
                totalCount={totalCount}
                onPageChange={setGlobalPage}
              />
            </div>
          </TabsContent>
        )}

        {/* Tab content — Your Questions */}
        <TabsContent value="mine" className="mt-4">
          <div className="surface-card frosted-shadow rounded-2xl p-4 space-y-3">
            <h2 className="text-base font-semibold text-ink-900">Your Questions</h2>
            <p className="text-sm text-ink-500">Questions you added, generated or uploaded</p>
            <QuestionList
              questions={currentQuestions}
              isLoading={isLoading}
              error={currentQuery.error}
              onRetry={refetch}
              canManage={canManage}
              onEdit={handleEdit}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
            />
            <PaginationBar
              page={minePage}
              totalPages={totalPages}
              totalCount={totalCount}
              onPageChange={setMinePage}
            />
          </div>
        </TabsContent>

        {/* Tab content — All Questions */}
        <TabsContent value="custom" className="mt-4">
          {!effectiveInstitutionId ? (
            <EmptyState
              icon={<Building2 className="h-7 w-7" />}
              title="No Institution Selected"
              description="Select an institution to view its custom question bank."
            />
          ) : (
            <div className="surface-card frosted-shadow rounded-2xl p-4 space-y-3">
              <h2 className="text-base font-semibold text-ink-900">All Questions</h2>
              <p className="text-sm text-ink-500">Institution-specific questions</p>
              <QuestionList
                questions={currentQuestions}
                isLoading={isLoading}
                error={currentQuery.error}
                onRetry={refetch}
                canManage={canManageCustom}
                onEdit={handleEdit}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
              />
              <PaginationBar
                page={customPage}
                totalPages={totalPages}
                totalCount={totalCount}
                onPageChange={setCustomPage}
              />
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Hidden ref button so TypeScript is happy with the ref (unused but kept for future use) */}
      <button ref={addBtnRef} type="button" className="sr-only" aria-hidden tabIndex={-1} />

      <AddQuestionToBankDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        institutionId={isGlobalTab ? null : effectiveInstitutionId}
        availableClassGroups={!isGlobalTab ? availableClassGroupsForDialog : undefined}
        availableSubjects={!isGlobalTab ? filteredSubjects : undefined}
      />
      <EditQuestionBankDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        question={editingQuestion}
      />
    </PageShell>
  );
}

function PaginationBar({
  page,
  totalPages,
  totalCount,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  totalCount: number;
  onPageChange: (p: number) => void;
}) {
  if (totalCount <= PAGE_SIZE) return null;

  return (
    <div className="flex items-center justify-between pt-4 border-t mt-4">
      <p className="text-sm text-muted-foreground">
        {formatNumber(totalCount)} questions · Page {page} of {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          Previous
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}

function QuestionList({
  questions,
  isLoading,
  error,
  onRetry,
  canManage,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  questions: QuestionBankItem[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  canManage: boolean;
  onEdit: (q: QuestionBankItem) => void;
  onDuplicate: (q: QuestionBankItem) => void;
  onDelete: (id: string) => void;
}) {
  if (isLoading) {
    return <Skeleton className="h-64 w-full rounded-2xl" />;
  }

  // Error BEFORE empty (§6): a failed read must never read as "no questions".
  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle className="h-7 w-7" />}
        title="Couldn't load questions"
        description={translateError(error, "Something went wrong loading questions. Please try again.").title}
        tone="rose"
        reason="error"
        action={{ label: "Try again", onClick: onRetry }}
      />
    );
  }

  if (questions.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen className="h-7 w-7" />}
        reason="noResults"
        title="No questions found"
        description="Try adjusting your filters or add new questions."
      />
    );
  }

  return (
    <ul className="list-none p-0 space-y-2">
      {questions.map((q) => {
        const qText = normalizeText(q.question_text);
        const truncated = qText.length > 80 ? qText.slice(0, 80) + "…" : qText;
        const subjectName = q.subject?.name ?? "N/A";
        const hasSubQuestions =
          (q as { sub_question_count?: number | null }).sub_question_count != null &&
          ((q as { sub_question_count?: number | null }).sub_question_count ?? 0) > 0;
        const typeLabel = labelForRowType(q.question_type, hasSubQuestions);

        return (
          <ListRow
            key={q.id}
            as="li"
            leading={
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary">
                <BookOpen className="h-5 w-5" />
              </span>
            }
            title={
              <span className="flex items-center gap-1.5 flex-wrap">
                {/* Own block, or the anonymous flex item never wraps and the
                    row clips the question mid-word ("Between the late 1960s
                    and t", 2026-09-18 audit). */}
                <span className="min-w-0 whitespace-normal break-words line-clamp-2">{truncated}</span>
                {(q as { source?: string }).source === "ai_generated" && (
                  <Badge variant="secondary" className="shrink-0 gap-1 text-xs">
                    <Sparkles className="h-3 w-3" /> AI
                  </Badge>
                )}
                {(q as { source?: string }).source === "bulk_upload" && (
                  <Badge variant="outline" className="shrink-0 gap-1 text-xs">
                    <Upload className="h-3 w-3" /> Bulk
                  </Badge>
                )}
              </span>
            }
            subtitle={`${typeLabel} · ${subjectName} · ${q.marks} mark${q.marks !== 1 ? "s" : ""}`}
            trailing={
              canManage ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => onEdit(q)}>
                      <Edit className="h-4 w-4 mr-2" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onDuplicate(q)}>
                      <Copy className="h-4 w-4 mr-2" /> Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => onDelete(q.id)}
                      className="text-destructive"
                    >
                      <Trash2 className="h-4 w-4 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null
            }
          />
        );
      })}
    </ul>
  );
}
