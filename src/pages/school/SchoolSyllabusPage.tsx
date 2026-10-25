import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  BookOpen,
  Plus,
  Search,
  GraduationCap,
  Layers,
  FileText,
  FolderOpen,
  Upload,
  LayoutGrid,
  AlertCircle,
  Network,
  RotateCcw,
  GripVertical,
} from "lucide-react";
import { PageShell, PageHeader, MobileFab } from "@/components/shared/page";
import { ClayStatTile, EmptyState as SharedEmptyState } from "@/components/shared/surfaces";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { motion, AnimatePresence } from "framer-motion";
import { cn, formatClassName } from "@/lib/utils";
import { invalidateSyllabusCache } from "@/lib/queryKeys";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { useHideGlobalTopic, useUnhideGlobalTopic } from "@/hooks/useHiddenGlobalTopics";
import { sortClassRows } from "@/lib/classSort";

// Components
import { GradeCard } from "@/components/syllabus/GradeCard";
import { SubjectCard } from "@/components/syllabus/SubjectCard";
import { TopicAccordion } from "@/components/syllabus/TopicAccordion";
import { SyllabusBreadcrumb } from "@/components/syllabus/SyllabusBreadcrumb";
import { AddTopicToSubjectDialog } from "@/components/syllabus/AddTopicToSubjectDialog";
import { AddMaterialToTopicDialog } from "@/components/syllabus/AddMaterialToTopicDialog";
import { AssignSubjectsDialog } from "@/components/syllabus/AssignSubjectsDialog";
import { SyllabusTreeView } from "@/components/syllabus/SyllabusTreeView";
import { BulkUploadSubjectsTopicsDialog } from "@/components/syllabus/BulkUploadSubjectsTopicsDialog";
import { BulkUploadMaterialsDialog } from "@/components/syllabus/BulkUploadMaterialsDialog";
import { AddSchoolSubjectDialog } from "@/components/syllabus/AddSchoolSubjectDialog";
import OptionalGroupsSheet from "@/components/syllabus/OptionalGroupsSheet";
import { AddSchoolTopicDialog } from "@/components/syllabus/AddSchoolTopicDialog";
import { AddSchoolStudyMaterialDialog } from "@/components/syllabus/AddSchoolStudyMaterialDialog";
import { EditSubjectDialog } from "@/components/syllabus/EditSubjectDialog";

// Hooks
import { useUserRole } from "@/hooks/useUserRole";
import { useIsSyllabusManager } from "@/hooks/useIsSyllabusManager";
import { useActiveRole } from "@/contexts/ActiveRoleContext";
import { useInstitutionFeatures } from "@/hooks/useInstitutionFeatures";
import { SegmentManagerSheet } from "@/components/syllabus/segments/SegmentManagerSheet";
import { useAuth } from "@/hooks/useAuth";
import { useCoordinatorClasses } from "@/hooks/useCoordinatorClasses";
import { useTeacherAssignedSubjects } from "@/hooks/useTeacherAssignedSubjects";
import { useDeleteSchoolSubject, useRemoveSubjectFromClass } from "@/hooks/useManageSchoolSubject";
import { logActivityEvent } from "@/lib/activityLog";
import {
  type GradeLevel,
  type Subject,
  type Topic,
  type SyllabusTreeData,
} from "@/hooks/useSyllabusHierarchy";

// Drag-to-reorder (chapters in panel view)
import {
  DndContext, DragOverlay, KeyboardSensor, PointerSensor,
  useSensor, useSensors, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChapterReorderHandle } from "@/components/syllabus/ChapterReorderHandle";
import { useReorderTopics, useResetTopicOrder } from "@/hooks/useReorderTopics";

type ViewMode = "tree" | "panel";

interface SyllabusFilterOptions {
  teacherUserId?: string;
  coordinatorClassIds?: string[];
  /** When false, the heavy tree query is skipped entirely. Used so we don't
   * burn 30+ sequential round-trips while the user is sitting on Panel view
   * (or any other tab) — TanStack Query keeps the cache around when the user
   * later switches back. */
  enabled?: boolean;
}

// Inline structural types for the rows this page selects. Used to keep the
// query result types narrow without pulling in the full generated Supabase
// types (which return Supabase joins as `T | T[]` and force ugly casts).
type TopicPageRow = {
  id: string;
  subject_id: string;
  topic_name: string;
  topic_name_hindi: string | null;
  difficulty_level: string | null;
  display_order: number | null;
  institution_id: string | null;
};

type MaterialPageRow = {
  id: string;
  topic_id: string | null;
  title: string;
  material_type: string;
  file_url: string | null;
  external_link: string | null;
};

type UniversalSubjectRow = {
  id: string;
  name: string;
  code: string;
  category: string | null;
  institution_id: string | null;
  is_active: boolean | null;
  display_order?: number | null;
};

type SubjectSummary = {
  id: string;
  name: string;
  code: string;
  category: string | null;
  institution_id: string | null;
};

// Hook to fetch syllabus filtered by institution's subject_class_mappings
// Groups by class instead of grade_level to properly show institute subjects
// Now supports role-based filtering via options parameter
function useInstitutionSyllabusTree(
  institutionId: string | null | undefined,
  userId: string | null | undefined,
  options?: SyllabusFilterOptions
) {
  const { teacherUserId, coordinatorClassIds, enabled = true } = options || {};
  return useQuery({
    queryKey: ["institution-syllabus-tree-v5", institutionId, teacherUserId, coordinatorClassIds, userId],
    // Keep the cache fresh across view-mode swaps. Without this, TanStack
    // Query's default staleTime: 0 would refetch on every component remount.
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!institutionId) return [];
      
      // Step 1: Get classes for this institution with their grade info
      const classQuery = supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      const { data: allClasses, error: classesError } = await classQuery;

      if (classesError) throw classesError;
      if (!allClasses || allClasses.length === 0) return [];

      // Apply role-based filtering on classes
      let classes = allClasses;
      
      // For coordinators, filter to their assigned wing classes
      if (coordinatorClassIds) {
        classes = allClasses.filter(c => coordinatorClassIds.includes(c.id));
      }

      // For teachers, we'll filter subjects later based on their assignments
      const classIds = classes.map(c => c.id);
      if (classIds.length === 0) return [];

      // Step 2: Get subject_class_mappings for those classes with subject details
      const mappingsQuery = supabase
        .from("subject_class_mappings")
        .select(`
          subject_id,
          class_id,
          universal_subjects!inner(id, name, code, category, institution_id, is_active)
        `)
        .in("class_id", classIds);

      const { data: mappings, error: mappingsError } = await mappingsQuery;

      if (mappingsError) throw mappingsError;
      if (!mappings || mappings.length === 0) return [];

      // For teachers, filter mappings to only their assigned class-subject pairs
      let filteredMappings = mappings;
      if (teacherUserId) {
        // Get teacher's specific class-subject assignments
        const { data: teacherAssignments, error: assignmentError } = await supabase
          .from("class_assignments")
          .select("class_id, subject_id")
          .eq("user_id", teacherUserId)
          .eq("role", "teacher");

        if (assignmentError) throw assignmentError;

        if (teacherAssignments && teacherAssignments.length > 0) {
          // Create a set of allowed class-subject pairs
          const allowedPairs = new Set(
            teacherAssignments.map(a => `${a.class_id}-${a.subject_id}`)
          );
          
          // Filter mappings to only include teacher's assigned class-subject pairs
          filteredMappings = mappings.filter(m => 
            allowedPairs.has(`${m.class_id}-${m.subject_id}`)
          );
        } else {
          // Teacher has no assignments - return empty
          return [];
        }
      }

      if (filteredMappings.length === 0) return [];

      // Step 3: Get unique subject IDs from filtered mappings
      const subjectIds = [...new Set(filteredMappings.map(m => m.subject_id))];

      // Step 4: Fetch topics for these subjects (institution-specific + global).
      // Run a count query first so we know how many ranged pages we need,
      // then fire all pages in parallel. The old serial while-loop did 3+
      // round-trips for 2777 topics; this collapses to count + ceil(N/1000)
      // concurrent requests.
      const pageSize = 1000;
      const topicsFilter = supabase
        .from("syllabus_topics")
        .select("id, subject_id, topic_name, topic_name_hindi, difficulty_level, display_order, institution_id", {
          count: "exact",
          head: true,
        })
        .in("subject_id", subjectIds)
        .eq("is_active", true)
        .or(`institution_id.eq.${institutionId},institution_id.is.null`);

      const { count: topicsCount, error: topicsCountError } = await topicsFilter;
      if (topicsCountError) throw topicsCountError;

      const totalTopics = topicsCount ?? 0;
      const pageRequests =
        totalTopics === 0
          ? []
          : Array.from({ length: Math.ceil(totalTopics / pageSize) }, (_, i) =>
              supabase
                .from("syllabus_topics")
                .select(
                  "id, subject_id, topic_name, topic_name_hindi, difficulty_level, display_order, institution_id",
                )
                .in("subject_id", subjectIds)
                .eq("is_active", true)
                .or(`institution_id.eq.${institutionId},institution_id.is.null`)
                // `display_order` alone is NOT a unique sort key — institutions
                // with bulk-imported chapters have hundreds of rows all tied at
                // display_order=1. Without a unique tiebreaker, each ranged page
                // re-sorts the ties arbitrarily, so rows at the 1000-row page
                // boundaries get duplicated in one page and dropped from the
                // result entirely — whole subjects then render "0 topics"
                // despite having chapters. `id` makes the total order
                // deterministic so range() pagination partitions every row
                // exactly once.
                .order("display_order")
                .order("id", { ascending: true })
                .range(i * pageSize, i * pageSize + pageSize - 1),
            );

      const topicPages = await Promise.all(pageRequests);
      const allTopics: TopicPageRow[] = [];
      for (const page of topicPages) {
        if (page.error) throw page.error;
        if (page.data) allTopics.push(...(page.data as unknown as TopicPageRow[]));
      }

      // Step 5: Fetch materials for topics. Same trick — issue every batch in
      // parallel instead of sequentially. Batch size bumped from 100 → 500 so
      // a typical institution (~3000 topics) needs ~6 batches rather than 30.
      // 500 UUIDs in an `in()` filter sits well under PostgREST URL-length
      // limits.
      const topicIds = allTopics.map((t) => t.id);

      // Step 4b: Personal per-user chapter-order overrides. Fetched in ONE
      // unfiltered query (RLS scopes rows to the caller, and a user has very
      // few override rows) — never filter by topicIds, which can run to
      // thousands and blow the URL length. Used below to re-sort each
      // subject's topics so the tree mirrors the panel's personal order.
      let overrideMap: Record<string, number> = {};
      if (userId) {
        const { data: ov, error: ovErr } = await supabase
          .from("user_topic_orders")
          .select("topic_id, display_order")
          .eq("user_id", userId);
        // Soft-fail: a transient overlay failure degrades to default order.
        if (ovErr) console.warn("[tree] personal chapter-order overlay failed", ovErr);
        overrideMap = (ov || []).reduce((acc, o) => {
          acc[o.topic_id] = o.display_order;
          return acc;
        }, {} as Record<string, number>);
      }

      const batchSize = 500;
      const materialBatches: string[][] = [];
      for (let i = 0; i < topicIds.length; i += batchSize) {
        materialBatches.push(topicIds.slice(i, i + batchSize));
      }
      const materialResults = await Promise.all(
        materialBatches.map((batch) =>
          supabase
            .from("study_materials")
            .select("id, topic_id, title, material_type, file_url, external_link")
            .eq("is_active", true)
            .in("topic_id", batch),
        ),
      );
      const allMaterials: MaterialPageRow[] = [];
      for (const r of materialResults) {
        if (r.error) throw r.error;
        if (r.data) allMaterials.push(...(r.data as unknown as MaterialPageRow[]));
      }

      // Step 5b: Which global chapters has this institution hidden? Used to
      // suppress them from the default view (toggleable via "Show hidden").
      // RLS scopes the SELECT to the caller's institution, no filter needed.
      const { data: hiddenRows } = await supabase
        .from("institution_hidden_topics")
        .select("topic_id");
      const hiddenSet = new Set((hiddenRows ?? []).map((r) => r.topic_id));

      // Build lookup maps - use filteredMappings for role-based filtering
      const subjectsByClass = filteredMappings.reduce((acc, m) => {
        const subject = m.universal_subjects as unknown as UniversalSubjectRow | null;
        if (!subject || !subject.is_active) return acc;
        if (!acc[m.class_id]) acc[m.class_id] = [];
        // Avoid duplicates
        if (!acc[m.class_id].find((s) => s.id === subject.id)) {
          acc[m.class_id].push({
            id: subject.id,
            name: subject.name,
            code: subject.code,
            category: subject.category,
            institution_id: subject.institution_id,
          });
        }
        return acc;
      }, {} as Record<string, SubjectSummary[]>);
      
      // Filter classes to only those that have subjects after filtering
      const classesWithSubjects = classes.filter(c => subjectsByClass[c.id]?.length > 0);

      const topicsBySubject = allTopics.reduce((acc, t) => {
        if (!acc[t.subject_id]) acc[t.subject_id] = [];
        acc[t.subject_id].push(t);
        return acc;
      }, {} as Record<string, typeof allTopics>);

      const materialsByTopic = allMaterials.reduce((acc, m) => {
        if (m.topic_id) {
          if (!acc[m.topic_id]) acc[m.topic_id] = [];
          acc[m.topic_id].push(m);
        }
        return acc;
      }, {} as Record<string, typeof allMaterials>);

      // Build tree grouped by class - use filtered classes
      const tree: SyllabusTreeData[] = classesWithSubjects.map(cls => {
        const classSubjects = subjectsByClass[cls.id] || [];
        
        return {
          id: cls.id,
          // Class names are stored like "Class 11 Science" / "Nursery", so a
          // bare parseInt returns NaN→0. Pull the first number in the name
          // (0 when there is none, e.g. Nursery/LKG) so grade search works.
          grade_number: parseInt(cls.name.match(/\d+/)?.[0] ?? "") || 0,
          grade_name: formatClassName(cls.name, cls.section),
          subjects: classSubjects.map((subject) => {
            // Filter hidden globals out at the source — keeps `topics.length`
            // (which drives the "N topics" badge on the subject row + the
            // grade and tree-level summaries) in sync with what actually
            // renders. Hiding is a one-way op for the school: once removed,
            // the chapter doesn't reappear in counts or in the tree.
            const subjectTopics = (topicsBySubject[subject.id] || []).filter(
              (t: { id: string }) => !hiddenSet.has(t.id)
            );

            // Apply personal per-user order: overridden chapters first by their
            // override value, the rest keep their global display_order (the
            // array already arrived display_order-sorted from the query), then
            // topic_name as a deterministic tiebreaker. Array.sort is stable in
            // modern engines, so non-overridden rows preserve their incoming
            // (display_order) order. Mirrors useInstitutionTopics (panel view).
            const BIG = Number.MAX_SAFE_INTEGER;
            subjectTopics.sort((a, b) => {
              const ao = overrideMap[a.id] ?? BIG;
              const bo = overrideMap[b.id] ?? BIG;
              if (ao !== bo) return ao - bo;
              const ad = a.display_order ?? BIG;
              const bd = b.display_order ?? BIG;
              if (ad !== bd) return ad - bd;
              return (a.topic_name || "").localeCompare(b.topic_name || "");
            });

            return {
              id: subject.id,
              name: subject.name,
              code: subject.code,
              category: subject.category,
              institution_id: subject.institution_id,
              topics: subjectTopics.map((topic) => ({
                id: topic.id,
                topic_name: topic.topic_name,
                topic_name_hindi: topic.topic_name_hindi,
                difficulty_level: topic.difficulty_level,
                // NOTE: institution_id MUST be forwarded — SyllabusTreeView reads
                // it to decide whether the delete should route to actual-delete
                // (institution-owned) or hide-from-school (global / null).
                institution_id: topic.institution_id ?? null,
                hidden_in_institution: false, // filtered above
                materials: (materialsByTopic[topic.id] || []).map((m) => ({
                  id: m.id,
                  title: m.title,
                  material_type: m.material_type,
                  file_url: m.file_url ?? null,
                  external_link: m.external_link ?? null,
                })),
              })),
            };
          }),
        };
      });

      // Filter out classes with no subjects, then apply canonical class order.
      const trimmed = tree.filter(t => t.subjects.length > 0);
      return sortClassRows(
        trimmed,
        // grade_name is "Class N – A" / "Nursery – A"; the rank logic in
        // classSort handles the prefix and section split for us.
        (t) => t.grade_name,
      );
    },
    enabled: !!institutionId && enabled,
  });
}

// Hook for classes with counts (replaces grade-based hook)
// Supports role-based filtering via options parameter
function useInstitutionClassesWithCounts(
  institutionId: string | null | undefined,
  options?: SyllabusFilterOptions
) {
  const { teacherUserId, coordinatorClassIds } = options || {};
  
  return useQuery({
    queryKey: ["institution-classes-counts-v3", institutionId, teacherUserId, coordinatorClassIds],
    queryFn: async (): Promise<{ grades: GradeLevel[]; uniqueSubjects: number; uniqueChapters: number }> => {
      const EMPTY = { grades: [] as GradeLevel[], uniqueSubjects: 0, uniqueChapters: 0 };
      if (!institutionId) return EMPTY;

      // Get classes for this institution
      const { data: allClasses, error: classesError } = await supabase
        .from("classes")
        .select("id, name, section, academic_year, is_active")
        .eq("institution_id", institutionId)
        .eq("is_active", true)
        .order("name");

      if (classesError) throw classesError;
      if (!allClasses || allClasses.length === 0) return EMPTY;

      // Apply role-based filtering
      let classes = allClasses;
      
      if (coordinatorClassIds) {
        classes = allClasses.filter(c => coordinatorClassIds.includes(c.id));
      }
      
      // For teachers, get their assigned class-subject pairs
      let teacherAssignments: { class_id: string; subject_id: string }[] = [];
      if (teacherUserId) {
        const { data: assignments } = await supabase
          .from("class_assignments")
          .select("class_id, subject_id")
          .eq("user_id", teacherUserId)
          .eq("role", "teacher");
        
        teacherAssignments = assignments || [];
        const teacherClassIds = [...new Set(teacherAssignments.map(a => a.class_id))];
        classes = allClasses.filter(c => teacherClassIds.includes(c.id));
      }

      if (classes.length === 0) return EMPTY;

      const classIds = classes.map(c => c.id);

      // Get subject_class_mappings for counts
      const mappingsQuery = supabase
        .from("subject_class_mappings")
        .select("class_id, subject_id")
        .in("class_id", classIds);

      const { data: allMappings, error: mappingsError } = await mappingsQuery;
      if (mappingsError) throw mappingsError;

      // For teachers, filter mappings to only their assigned subjects
      let mappings = allMappings || [];
      if (teacherUserId && teacherAssignments.length > 0) {
        const allowedPairs = new Set(
          teacherAssignments.map(a => `${a.class_id}-${a.subject_id}`)
        );
        mappings = mappings.filter(m => allowedPairs.has(`${m.class_id}-${m.subject_id}`));
      }

      // Count subjects per class
      const subjectCountMap = mappings.reduce((acc, m) => {
        acc[m.class_id] = (acc[m.class_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      // Get topic counts per subject (we need unique subjects first)
      const subjectIds = [...new Set(mappings.map(m => m.subject_id))];
      
      const topicCountMap: Record<string, number> = {};
      if (subjectIds.length > 0) {
        // This count is unbounded — a single SELECT is silently capped at 1000
        // rows by PostgREST (CLAUDE.md §23), so institutions with >1000 chapters
        // under-count (the per-class "N topics" badge then disagrees with the
        // tree). Page through with a stable, unique sort key (id) so range()
        // partitions every matching row exactly once.
        const countPageSize = 1000;
        const { count: topicTotal } = await supabase
          .from("syllabus_topics")
          .select("subject_id", { count: "exact", head: true })
          .in("subject_id", subjectIds)
          .eq("is_active", true)
          .or(`institution_id.eq.${institutionId},institution_id.is.null`);

        const totalCount = topicTotal ?? 0;
        const countPages =
          totalCount === 0
            ? []
            : await Promise.all(
                Array.from({ length: Math.ceil(totalCount / countPageSize) }, (_, i) =>
                  supabase
                    .from("syllabus_topics")
                    .select("subject_id")
                    .in("subject_id", subjectIds)
                    .eq("is_active", true)
                    .or(`institution_id.eq.${institutionId},institution_id.is.null`)
                    .order("id", { ascending: true })
                    .range(i * countPageSize, i * countPageSize + countPageSize - 1),
                ),
              );

        for (const page of countPages) {
          for (const t of page.data ?? []) {
            topicCountMap[t.subject_id] = (topicCountMap[t.subject_id] || 0) + 1;
          }
        }
      }

      // Map topics to classes through subject mappings
      const classTopicCountMap: Record<string, number> = {};
      mappings.forEach(m => {
        const topicCount = topicCountMap[m.subject_id] || 0;
        classTopicCountMap[m.class_id] = (classTopicCountMap[m.class_id] || 0) + topicCount;
      });

      // Filter classes to only those with subjects after filtering, then
      // apply the canonical platform-wide order (Nursery → … → Class 12).
      const classesWithSubjects = sortClassRows(
        classes.filter(c => subjectCountMap[c.id] > 0),
        (c) => c.name,
        (c) => c.section,
      );

      const grades = classesWithSubjects.map((c) => ({
        id: c.id,
        grade_number: parseInt(c.name.match(/\d+/)?.[0] ?? "") || 0,
        grade_name: formatClassName(c.name, c.section),
        is_active: c.is_active ?? true,
        topic_count: classTopicCountMap[c.id] || 0,
        subject_count: subjectCountMap[c.id] || 0,
      })) as GradeLevel[];

      // Distinct totals for the page's KPI tiles — count each subject and
      // chapter ONCE across the whole syllabus, not once per class-section that
      // shares it. subjectIds is already de-duplicated; every topic belongs to
      // exactly one subject, so summing topicCountMap yields distinct chapters.
      const uniqueSubjects = subjectIds.length;
      const uniqueChapters = Object.values(topicCountMap).reduce((a, b) => a + b, 0);

      return { grades, uniqueSubjects, uniqueChapters };
    },
    enabled: !!institutionId,
  });
}

// Hook for subjects by class (replaces grade-based hook)
// Supports role-based filtering via options parameter
function useInstitutionSubjectsByClass(
  classId: string | null,
  institutionId: string | null | undefined,
  options?: SyllabusFilterOptions
) {
  const { teacherUserId } = options || {};
  
  return useQuery({
    queryKey: ["institution-subjects-class-v3", classId, institutionId, teacherUserId],
    queryFn: async () => {
      if (!classId || !institutionId) return [];

      // Get subject_class_mappings for this class with subject details
      const { data: allMappings, error: mappingsError } = await supabase
        .from("subject_class_mappings")
        .select(`
          subject_id,
          universal_subjects!inner(id, name, code, category, institution_id, is_active, display_order)
        `)
        .eq("class_id", classId);

      if (mappingsError) throw mappingsError;
      if (!allMappings || allMappings.length === 0) return [];

      // For teachers, filter to only their assigned subjects
      let mappings = allMappings;
      if (teacherUserId) {
        const { data: assignments } = await supabase
          .from("class_assignments")
          .select("subject_id")
          .eq("user_id", teacherUserId)
          .eq("class_id", classId)
          .eq("role", "teacher");
        
        if (assignments && assignments.length > 0) {
          const allowedSubjectIds = new Set(assignments.map(a => a.subject_id));
          mappings = allMappings.filter(m => allowedSubjectIds.has(m.subject_id));
        } else {
          return []; // No assignments for this teacher in this class
        }
      }

      const subjects = mappings
        .map((m) => m.universal_subjects as unknown as UniversalSubjectRow | null)
        .filter((s): s is UniversalSubjectRow => Boolean(s && s.is_active !== false));

      const subjectIds = subjects.map((s) => s.id);
      if (subjectIds.length === 0) return [];

      // Get topic counts
      const { data: topics } = await supabase
        .from("syllabus_topics")
        .select("subject_id")
        .in("subject_id", subjectIds)
        .eq("is_active", true)
        .or(`institution_id.eq.${institutionId},institution_id.is.null`);

      const topicCountMap = (topics || []).reduce((acc, t) => {
        acc[t.subject_id] = (acc[t.subject_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      return subjects.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        category: s.category,
        display_order: s.display_order,
        institution_id: s.institution_id,
        topic_count: topicCountMap[s.id] || 0,
      })) as Subject[];
    },
    enabled: !!classId && !!institutionId,
  });
}

// Hook for topics by class and subject
function useInstitutionTopics(
  classId: string | null,
  subjectId: string | null,
  institutionId: string | null | undefined,
  userId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["institution-topics-v3", classId, subjectId, institutionId, userId],
    queryFn: async () => {
      if (!subjectId || !institutionId) return [];

      const { data: topics, error } = await supabase
        .from("syllabus_topics")
        .select("*")
        .eq("subject_id", subjectId)
        .eq("is_active", true)
        .or(`institution_id.eq.${institutionId},institution_id.is.null`)
        .order("display_order");
      if (error) throw error;

      const topicIds = (topics || []).map((t) => t.id);
      if (topicIds.length === 0) return [];

      // Personal per-user order overrides (RLS scopes to the caller).
      let overrideMap: Record<string, number> = {};
      if (userId) {
        const { data: overrides, error: overrideErr } = await supabase
          .from("user_topic_orders")
          .select("topic_id, display_order")
          .eq("user_id", userId)
          .in("topic_id", topicIds);
        // Soft-fail: a transient overlay failure degrades to the default order
        // (better than blanking the list). Logged for observability, no toast.
        if (overrideErr) console.warn("[useInstitutionTopics] personal chapter-order overlay failed; using default order", overrideErr);
        overrideMap = (overrides || []).reduce((acc, o) => {
          acc[o.topic_id] = o.display_order;
          return acc;
        }, {} as Record<string, number>);
      }

      const { data: materials } = await supabase
        .from("study_materials")
        .select("topic_id")
        .in("topic_id", topicIds)
        .eq("is_active", true);
      const materialCountMap = (materials || []).reduce((acc, m) => {
        if (m.topic_id) acc[m.topic_id] = (acc[m.topic_id] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      const enriched = (topics || []).map((t) => ({
        ...t,
        material_count: materialCountMap[t.id] || 0,
      }));

      // Effective order: overridden chapters first (by override), then the rest
      // by global display_order, then topic_name. Stable + deterministic.
      const BIG = Number.MAX_SAFE_INTEGER;
      enriched.sort((a, b) => {
        const ao = overrideMap[a.id] ?? BIG;
        const bo = overrideMap[b.id] ?? BIG;
        if (ao !== bo) return ao - bo;
        const ad = a.display_order ?? BIG;
        const bd = b.display_order ?? BIG;
        if (ad !== bd) return ad - bd;
        return (a.topic_name || "").localeCompare(b.topic_name || "");
      });

      return enriched as Topic[];
    },
    enabled: !!subjectId && !!institutionId,
  });
}

// Hook for materials by topic
function useMaterialsByTopic(topicId: string | null) {
  return useQuery({
    queryKey: ["materials-by-topic", topicId],
    queryFn: async () => {
      if (!topicId) return [];

      const { data, error } = await supabase
        .from("study_materials")
        .select("*")
        .eq("topic_id", topicId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data;
    },
    enabled: !!topicId,
  });
}

// Delete mutations
//
// Delete-then-verify: the DELETE response by itself isn't authoritative
// (PostgREST's RETURNING is gated by the SELECT policy chain, so a permitted
// DELETE can come back with empty data). We re-query the row by id and treat
// "row gone" as the definitive success signal.
function useDeleteTopic() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (topicId: string) => {
      const { error: deleteError } = await supabase
        .from("syllabus_topics")
        .delete()
        .eq("id", topicId);
      if (deleteError) throw deleteError;

      const { data: stillThere } = await supabase
        .from("syllabus_topics")
        .select("id, institution_id")
        .eq("id", topicId)
        .maybeSingle();
      if (stillThere) {
        if (stillThere.institution_id === null) {
          throw new Error(
            "You don't have permission to delete this chapter. It's shared across schools. Use 'Hide from your school' instead."
          );
        }
        throw new Error(
          "You don't have permission to delete this chapter. Ask a school admin if you think this is wrong."
        );
      }
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Chapter deleted");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the chapter.", context: "deleteChapter" });
    },
  });
}

function useDeleteMaterial() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (materialId: string) => {
      const { error } = await supabase
        .from("study_materials")
        .delete()
        .eq("id", materialId);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateSyllabusCache(queryClient);
      toast.success("Material deleted");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the material.", context: "deleteMaterial" });
    },
  });
}

// ---------------------------------------------------------------------------
// PanelCard — shared chrome for the three panels in the desktop "panel view".
// Replaces the raw shadcn Card + CardHeader + CardTitle + ScrollArea stack
// with a single component that bakes in Phase 9 visual identity (surface-card
// + frosted-shadow + rounded-card + ink-* text + tone-tinted icon disc + tiny
// eyebrow caption). Each panel only varies on (tone, eyebrow, title, search,
// count, optional headerAction, body).
// ---------------------------------------------------------------------------

type PanelTone = "teal" | "violet" | "peach";

const PANEL_TONE_CLASSES: Record<PanelTone, { bg: string; fg: string; ring: string }> = {
  teal:   { bg: "bg-brand-primary/10",   fg: "text-brand-primary",   ring: "ring-brand-primary/15" },
  violet: { bg: "bg-brand-secondary/10", fg: "text-brand-secondary", ring: "ring-brand-secondary/15" },
  peach:  { bg: "bg-brand-warm/15",      fg: "text-brand-warm",      ring: "ring-brand-warm/20" },
};

interface PanelCardProps {
  className?: string;
  tone: PanelTone;
  eyebrow: string;
  title: string;
  icon: React.ReactNode;
  count?: number;
  headerAction?: React.ReactNode;
  search?: {
    value: string;
    onChange: (next: string) => void;
    placeholder: string;
    disabled?: boolean;
  };
  children: React.ReactNode;
}

function PanelCard({
  className,
  tone,
  eyebrow,
  title,
  icon,
  count,
  headerAction,
  search,
  children,
  isEmpty,
}: PanelCardProps & { isEmpty?: boolean }) {
  const t = PANEL_TONE_CLASSES[tone];
  return (
    <div
      className={cn(
        // h-full so this card fills whatever cell or ResizablePanel it lives
        // inside; without it the empty middle/right panels were collapsing to
        // content height and looked like blank page background.
        "flex flex-col h-full min-h-0 surface-card frosted-shadow rounded-card overflow-hidden ring-1 ring-surface-stroke/60",
        className,
      )}
    >
      <div className="px-3 pt-3 pb-2.5 border-b border-surface-stroke/60 space-y-2.5 shrink-0">
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ring-1 ring-inset",
              t.bg,
              t.fg,
              t.ring,
            )}
          >
            {icon}
          </span>
          <div className="flex-1 min-w-0">
            <p className="eyebrow truncate" title={eyebrow}>
              {eyebrow}
            </p>
            <div className="flex items-baseline gap-2">
              <h3 className="text-[15px] leading-5 font-semibold text-ink-900 truncate">
                {title}
              </h3>
              {typeof count === "number" && (
                <span className="text-xs font-medium text-ink-500">{count}</span>
              )}
            </div>
          </div>
          {headerAction && <div className="shrink-0">{headerAction}</div>}
        </div>
        {search && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-500" />
            <Input
              placeholder={search.placeholder}
              className="pl-9 h-9 rounded-xl bg-surface-base/70"
              value={search.value}
              onChange={(e) => search.onChange(e.target.value)}
              disabled={search.disabled}
            />
          </div>
        )}
      </div>
      {/* Radix lays the viewport's child out as a table, which grows to the
          widest unwrapped row and let the Chapters panel spill past its right
          edge (Naman, 2026-10-07). As a block it is the viewport's width and
          the rows wrap inside it. */}
      <ScrollArea className="flex-1 min-h-0 [&_[data-radix-scroll-area-viewport]>div]:!block">
        {/* When the panel body is empty (skeleton or empty state), force the
            inner container to stretch so SharedEmptyState's centering picks
            up vertical room. Lists use the natural top-aligned flow. */}
        <div className={cn("p-3", isEmpty && "min-h-full flex flex-col justify-center")}>
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}

// Sortable wrapper for one chapter row in panel view. Renders its drag handle
// (the 3s-hold ChapterReorderHandle) via a render-prop so the caller can slot
// it into TopicAccordion's leadingSlot while keeping all row handlers intact.
function SortableTopicRow({
  topicId,
  chapterName,
  children,
}: {
  topicId: string;
  chapterName: string;
  children: (handle: React.ReactNode) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: topicId });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children(
        <ChapterReorderHandle
          chapterName={chapterName}
          attributes={attributes}
          listeners={listeners}
          setActivatorNodeRef={setActivatorNodeRef}
        />,
      )}
    </div>
  );
}

export default function SchoolSyllabusPage() {
  const { data: roleInfo } = useUserRole();
  const { activeViewRole, hasDualRole } = useActiveRole();
  const { isFeatureEnabled } = useInstitutionFeatures();
  const { user } = useAuth();
  const { classIds: coordinatorClassIds } = useCoordinatorClasses();
  const institutionId = roleInfo?.institutionId;

  // Chapter drag-to-reorder (panel view, no-search only)
  const queryClient = useQueryClient();
  const reorderTopics = useReorderTopics();
  const resetTopicOrder = useResetTopicOrder();
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { delay: 2000, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Determine effective role - one hat at a time, never a union.
  // "admin" maps back to the concrete admin role so every downstream
  // comparison against "school_admin" / "super_school_admin" is unchanged.
  const rawEffectiveRole = hasDualRole
    ? (activeViewRole === "admin" ? roleInfo?.primaryRole : activeViewRole)
    : roleInfo?.primaryRole;

  // Per-user override grant (syllabus_manager_overrides): a named teacher
  // given institution-wide syllabus management without a role change.
  // Resolving it to "school_admin" HERE — at the single source every
  // downstream check reads — is deliberate: filterOptions (class scope),
  // canAddSubjects / canManageSubjects / canManageSubjectsGlobally /
  // canAddTopics / isAdmin, and the coordinatorClassIds + teacherUserId
  // props all derive from effectiveRole, so one substitution keeps them
  // consistent instead of 10 hand-edited flags drifting apart.
  // Server-side RLS enforces the same grant independently.
  const { isSyllabusManager } = useIsSyllabusManager();
  const effectiveRole = isSyllabusManager ? "school_admin" : rawEffectiveRole;
  
  // Determine filter options based on EFFECTIVE role (strictly one role at a time)
  const filterOptions: SyllabusFilterOptions = (() => {
    // Super Admin or School Admin - full access to entire institution
    if (effectiveRole === "super_admin" || effectiveRole === "school_admin" || effectiveRole === "super_school_admin") {
      return {};
    }
    
    // Coordinator - sees all subjects of assigned wing classes only
    // Must NOT see unassigned classes, but sees ALL subjects within those classes
    if (effectiveRole === "coordinator") {
      return { coordinatorClassIds };
    }
    
    // Teacher - sees ONLY assigned class-subject combinations
    // Each class-subject pair appears as a separate entity
    // Must NOT see other subjects of the same class
    // Must NOT see other classes of the school
    if (effectiveRole === "teacher") {
      return { teacherUserId: user?.id || undefined };
    }
    
    // Student or other roles - no access (return empty which will show nothing)
    return {};
  })();
  
  // View mode
  const [viewMode, setViewMode] = useState<ViewMode>("tree");
  
  // Selection state (for panel view)
  const [selectedGrade, setSelectedGrade] = useState<GradeLevel | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<Subject | null>(null);
  const [expandedTopicId, setExpandedTopicId] = useState<string | null>(null);
  
  // Search state
  const [gradeSearch, setGradeSearch] = useState("");
  const [subjectSearch, setSubjectSearch] = useState("");
  const [topicSearch, setTopicSearch] = useState("");

  // Dialog states
  const [isAddTopicOpen, setIsAddTopicOpen] = useState(false);
  const [segmentCtx, setSegmentCtx] = useState<{
    classId: string;
    subjectId: string;
    subjectName: string;
    className: string;
  } | null>(null);
  const [isAssignSubjectsOpen, setIsAssignSubjectsOpen] = useState(false);
  const [isBulkUploadSubjectsTopicsOpen, setIsBulkUploadSubjectsTopicsOpen] = useState(false);
  const [isBulkUploadMaterialsOpen, setIsBulkUploadMaterialsOpen] = useState(false);
  // Page-level drag-and-drop. We route by file extension:
  //   - Spreadsheet (CSV/Excel) → bulk subject/chapter upload (admin only)
  //   - Anything else (PDF, image, video, audio, doc) → study material
  // Each route stashes the file in its own slot and opens the right dialog,
  // which ingests + clears via callback.
  const [pendingBulkUploadFile, setPendingBulkUploadFile] = useState<File | null>(null);
  const [pendingStudyMaterialFile, setPendingStudyMaterialFile] = useState<File | null>(null);
  // Captured at drop time from the DOM row the user dropped onto (tree view)
  // or from current panel selection. Passed to the study-material dialog as
  // `initialContext` so the class/subject/chapter dropdowns are pre-filled.
  const [pendingStudyMaterialContext, setPendingStudyMaterialContext] = useState<{
    classId?: string | null;
    subjectId?: string | null;
    topicId?: string | null;
  } | null>(null);
  const [isPageDragging, setIsPageDragging] = useState(false);
  // New "Add New" dialog states
  const [isAddSchoolSubjectOpen, setIsAddSchoolSubjectOpen] = useState(false);
  const [isAddSchoolTopicOpen, setIsAddSchoolTopicOpen] = useState(false);
  const [isAddSchoolMaterialOpen, setIsAddSchoolMaterialOpen] = useState(false);
  const [isOptionalGroupsOpen, setIsOptionalGroupsOpen] = useState(false);
  const [addMaterialContext, setAddMaterialContext] = useState<{
    topic: Topic;
    gradeId: string;
    gradeName: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);
  const [addTopicContext, setAddTopicContext] = useState<{
    gradeId: string;
    gradeName: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);
  const [addMaterialTreeContext, setAddMaterialTreeContext] = useState<{
    topicId: string;
    topicName: string;
    gradeId: string;
    gradeName: string;
    subjectId: string;
    subjectName: string;
  } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<
    | { type: "topic"; id: string; institutionId: string | null; name?: string | null }
    | { type: "material"; id: string; name?: string | null }
    | {
        type: "subject";
        kind: "hard" | "remove";
        id: string;
        name: string;
        institutionId: string | null;
        classId: string;
        className: string;
      }
    | null
  >(null);

  const [editSubjectCtx, setEditSubjectCtx] = useState<{
    id: string;
    name: string;
    category: string | null;
    institutionId: string;
    classId: string;
    className: string;
  } | null>(null);

  // Queries - using class-based hooks with role-based filtering
  const { data: classCounts, isLoading: gradesLoading } = useInstitutionClassesWithCounts(institutionId, filterOptions);
  const grades = classCounts?.grades ?? [];
  const { data: gradeSubjects = [], isLoading: subjectsLoading } = useInstitutionSubjectsByClass(selectedGrade?.id || null, institutionId, filterOptions);
  const { data: topics = [], isLoading: topicsLoading } = useInstitutionTopics(
    selectedGrade?.id || null,
    selectedSubject?.id || null,
    institutionId,
    user?.id || null
  );
  const { data: expandedTopicMaterials = [], isLoading: materialsLoading } = useMaterialsByTopic(expandedTopicId);
  // Gate the heavy tree query on the active view. The tree fetch pulls every
  // class → subject → topic → material in one shot (3+30+ round-trips for a
  // typical institution); running it while the user is on Panel view just
  // burns network and blocks the lighter per-panel queries.
  const { data: treeData = [], isLoading: treeLoading } = useInstitutionSyllabusTree(
    institutionId,
    user?.id ?? null,
    { ...filterOptions, enabled: viewMode === "tree" },
  );

  // Mutations
  const deleteTopic = useDeleteTopic();
  const deleteMaterial = useDeleteMaterial();
  const hideGlobalTopic = useHideGlobalTopic();
  const unhideGlobalTopic = useUnhideGlobalTopic();
  const deleteSubject = useDeleteSchoolSubject();
  const removeSubject = useRemoveSubjectFromClass();

  // Permission checks based on EFFECTIVE role (strict role-based permissions)
  // Admin permissions must NOT be inherited by Teacher or Coordinator.
  //
  // canAddSubjects — shows the "Add Subject" dropdown item. Coordinators
  // are included but their dialog is wing-scoped via coordinatorClassIds
  // (see AddSchoolSubjectDialog + migration 20260421120000).
  //
  // canManageSubjectsGlobally — gates institution-wide surfaces: the panel
  // "Manage Subjects" button (opens AssignSubjectsDialog which reassigns
  // global subjects across a grade) and the Bulk Upload dropdown. These
  // remain admin-only because they act on the whole institution.
  const canAddSubjects = effectiveRole === "school_admin" || effectiveRole === "super_admin" || effectiveRole === "super_school_admin" || effectiveRole === "coordinator";
  const canManageSubjectsGlobally = effectiveRole === "school_admin" || effectiveRole === "super_admin" || effectiveRole === "super_school_admin";
  const canAddTopics = effectiveRole === "school_admin" || effectiveRole === "super_admin" || effectiveRole === "super_school_admin" || effectiveRole === "coordinator" || effectiveRole === "teacher";
  const canAddMaterials = effectiveRole === "school_admin" || effectiveRole === "super_admin" || effectiveRole === "super_school_admin" || effectiveRole === "coordinator" || effectiveRole === "teacher";
  const canDeleteTopics = effectiveRole === "school_admin" || effectiveRole === "super_admin" || effectiveRole === "super_school_admin" || effectiveRole === "coordinator" || effectiveRole === "teacher";
  const canDeleteMaterials = effectiveRole === "school_admin" || effectiveRole === "super_admin" || effectiveRole === "super_school_admin" || effectiveRole === "coordinator" || effectiveRole === "teacher";

  const isAdmin =
    effectiveRole === "school_admin" ||
    effectiveRole === "super_admin" ||
    effectiveRole === "super_school_admin";
  // Subject edit/delete is for admins + coordinators only (never teachers).
  const canManageSubjects = isAdmin || effectiveRole === "coordinator";

  // Window-level drag-and-drop. Activated for any user who can put SOMETHING
  // into the syllabus — admins (bulk subjects + materials) or teachers /
  // coordinators (materials only). The drop handler routes by file extension.
  // The counter handles the well-known dragenter/leave child-event flicker —
  // every enter increments, every leave decrements, overlay only hides when
  // the counter returns to zero. A direct boolean toggle would flash off as
  // the drag moves between page children.
  const canDragDrop = canManageSubjectsGlobally || canAddMaterials;
  const dragCounterRef = useRef(0);

  // Snapshot of the panel-view selection. Drop targets in tree view publish
  // their context via data-drop-* attributes (read at drop time); panel view
  // has no per-row DOM markers so we fall back to whatever the user has
  // currently selected in the three-column layout.
  const panelSelectionRef = useRef<{
    classId: string | null;
    subjectId: string | null;
    topicId: string | null;
  }>({ classId: null, subjectId: null, topicId: null });
  useEffect(() => {
    panelSelectionRef.current = {
      classId: selectedGrade?.id ?? null,
      subjectId: selectedSubject?.id ?? null,
      topicId: expandedTopicId,
    };
  }, [selectedGrade, selectedSubject, expandedTopicId]);

  useEffect(() => {
    if (!canDragDrop) return;

    const isFileDrag = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");

    const handleEnter = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current += 1;
      setIsPageDragging(true);
    };
    const handleOver = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      // Browsers ignore drops unless dragover preventDefaults — without this
      // line the cursor stays "not-allowed" and the drop event never fires.
      e.preventDefault();
    };
    const handleLeave = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsPageDragging(false);
      }
    };
    const handleDrop = (e: DragEvent) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsPageDragging(false);

      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) {
        toast.error("Nothing was dropped. Try dragging the file from File Explorer.");
        return;
      }

      // Routing matrix:
      //   spreadsheet (CSV / TSV / Excel) → bulk subject + chapter upload
      //   anything else                   → individual study material
      // Spreadsheet route requires bulk-upload rights (admin). Without that
      // permission, a dropped Excel is treated as a study-material attachment
      // instead (Excel is a valid material type — `spreadsheet`).
      const SPREADSHEET = /\.(csv|tsv|xlsx|xls|xlsm|xlsb|xltx|xltm)$/i;

      if (canManageSubjectsGlobally) {
        const spreadsheet = files.find((f) => SPREADSHEET.test(f.name));
        if (spreadsheet) {
          setPendingBulkUploadFile(spreadsheet);
          setIsBulkUploadSubjectsTopicsOpen(true);
          return;
        }
      }

      // Fall through to study material. AddSchoolStudyMaterialDialog caps at
      // 50MB and rejects unknown types — let it surface the error message
      // there so the user can also pick a material type manually.
      if (canAddMaterials) {
        const materialFile = files[0];

        // Walk up from the drop target to read whichever tree row(s) the
        // user landed on. `closest()` returns the nearest ancestor with the
        // matching attribute, so dropping on a topic naturally also yields
        // its subject and grade ancestors.
        const target = e.target instanceof Element ? e.target : null;
        const topicEl = target?.closest("[data-drop-topic-id]") as HTMLElement | null;
        const subjectEl = target?.closest("[data-drop-subject-id]") as HTMLElement | null;
        const classEl = target?.closest("[data-drop-class-id]") as HTMLElement | null;

        const panelFallback = panelSelectionRef.current;
        const ctx = {
          classId: classEl?.dataset.dropClassId ?? panelFallback.classId,
          subjectId: subjectEl?.dataset.dropSubjectId ?? panelFallback.subjectId,
          topicId: topicEl?.dataset.dropTopicId ?? panelFallback.topicId,
        };

        setPendingStudyMaterialFile(materialFile);
        setPendingStudyMaterialContext(
          ctx.classId || ctx.subjectId || ctx.topicId ? ctx : null,
        );
        setIsAddSchoolMaterialOpen(true);
        return;
      }

      toast.error("You don't have permission to add files here.");
    };

    window.addEventListener("dragenter", handleEnter);
    window.addEventListener("dragover", handleOver);
    window.addEventListener("dragleave", handleLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleEnter);
      window.removeEventListener("dragover", handleOver);
      window.removeEventListener("dragleave", handleLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [canDragDrop, canManageSubjectsGlobally, canAddMaterials]);

  // Computed
  const filteredGrades = grades.filter(g => 
    g.grade_name.toLowerCase().includes(gradeSearch.toLowerCase()) ||
    g.grade_number.toString().includes(gradeSearch)
  );
  const filteredSubjects = gradeSubjects.filter(s =>
    s.name.toLowerCase().includes(subjectSearch.toLowerCase()) ||
    (s.code && s.code.toLowerCase().includes(subjectSearch.toLowerCase()))
  );
  const filteredTopics = topics.filter(t =>
    t.topic_name.toLowerCase().includes(topicSearch.toLowerCase()) ||
    (t.topic_name_hindi && t.topic_name_hindi.includes(topicSearch))
  );

  // Drag-to-reorder is only valid when no search filter is applied — reordering
  // a filtered subset would corrupt the saved per-user order.
  const reorderEnabled = topicSearch.trim() === "";
  const topicOrderIds = topics.map((t) => t.id);

  const handleTopicDragStart = (e: DragStartEvent) => setActiveDragId(String(e.active.id));

  const handleTopicDragEnd = (e: DragEndEvent) => {
    setActiveDragId(null);
    const { active, over } = e;
    if (!over || active.id === over.id || !user?.id || !selectedSubject?.id) return;
    const oldIndex = topicOrderIds.indexOf(String(active.id));
    const newIndex = topicOrderIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const ordered = arrayMove(topicOrderIds, oldIndex, newIndex);
    // optimistic: reorder the cached list under the EXACT read-hook key
    const key = ["institution-topics-v3", selectedGrade?.id || null, selectedSubject.id, institutionId, user.id || null];
    queryClient.setQueryData(key, (prev: typeof topics | undefined) =>
      prev ? ordered.map((id) => prev.find((t) => t.id === id)).filter((t): t is typeof prev[number] => Boolean(t)) : prev,
    );
    reorderTopics.mutate({ userId: user.id, subjectId: selectedSubject.id, orderedTopicIds: ordered });
  };

  const handleResetTopicOrder = () => {
    if (!user?.id) return;
    resetTopicOrder.mutate({ userId: user.id, topicIds: topics.map((t) => t.id) });
  };

  // Tree-view chapter reorder. Unlike the panel path (useReorderTopics, which
  // invalidates the whole syllabus cache), the tree query is heavy — so we
  // optimistically reorder the cached tree in place and persist the per-user
  // overrides WITHOUT a refetch. The persisted overrides + the query's
  // override-merge keep a later cold load correct. Key MUST match
  // useInstitutionSyllabusTree's queryKey exactly (incl. trailing user id).
  const handleTreeReorderChapters = useCallback(
    async (subjectId: string, orderedTopicIds: string[]) => {
      if (!user?.id) return;
      const treeKey = [
        "institution-syllabus-tree-v5",
        institutionId,
        filterOptions.teacherUserId,
        filterOptions.coordinatorClassIds,
        user.id,
      ];
      const prev = queryClient.getQueryData<SyllabusTreeData[]>(treeKey);
      // Optimistic: reorder this subject's topics wherever the subject appears.
      const orderIndex = new Map(orderedTopicIds.map((id, i) => [id, i]));
      queryClient.setQueryData<SyllabusTreeData[]>(treeKey, (old) => {
        if (!old) return old;
        return old.map((g) => ({
          ...g,
          subjects: g.subjects.map((s) =>
            s.id !== subjectId
              ? s
              : {
                  ...s,
                  topics: [...s.topics].sort(
                    (a, b) =>
                      (orderIndex.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
                      (orderIndex.get(b.id) ?? Number.MAX_SAFE_INTEGER),
                  ),
                },
          ),
        }));
      });
      const rows = orderedTopicIds.map((topic_id, i) => ({
        user_id: user.id,
        topic_id,
        display_order: i + 1,
      }));
      const { error } = await supabase
        .from("user_topic_orders")
        .upsert(rows, { onConflict: "user_id,topic_id" });
      if (error) {
        queryClient.setQueryData(treeKey, prev); // rollback
        toastError(error, {
          fallback: "Couldn't save the new order.",
          context: "reorderTreeChapters",
        });
      }
    },
    [
      user?.id,
      institutionId,
      filterOptions.teacherUserId,
      filterOptions.coordinatorClassIds,
      queryClient,
    ],
  );

  // Stats
  // KPI tiles show distinct totals across the whole syllabus (a subject or
  // chapter shared by several sections is counted once), not the per-section
  // sum. The per-class grade cards still show that class's own counts.
  const totalTopics = classCounts?.uniqueChapters ?? 0;
  const totalSubjects = classCounts?.uniqueSubjects ?? 0;

  // Navigation handlers
  const handleNavigateToGrades = () => {
    setSelectedGrade(null);
    setSelectedSubject(null);
    setExpandedTopicId(null);
  };

  const handleNavigateToSubjects = () => {
    setSelectedSubject(null);
    setExpandedTopicId(null);
  };

  const handleSelectGrade = (grade: GradeLevel) => {
    setSelectedGrade(grade);
    setSelectedSubject(null);
    setExpandedTopicId(null);
  };

  const handleSelectSubject = (subject: Subject) => {
    setSelectedSubject(subject);
    setExpandedTopicId(null);
  };

  // Delete handlers
  //
  // From the user's perspective there's one action: "delete this chapter". Under
  // the hood we route based on institution_id:
  //   - institution-owned chapter (institution_id matches caller): actually
  //     DELETE the row from syllabus_topics.
  //   - global NCERT chapter (institution_id IS NULL): can't be deleted at the
  //     DB level (would affect every school). We add it to institution_hidden_
  //     topics so it disappears from THIS school's view; other tenants keep it.
  // The user sees the same outcome either way: chapter gone from their tree.
  const handleDeleteTopic = (
    topicId: string,
    institutionId: string | null = null,
    name?: string,
  ) => {
    if (canDeleteTopics) {
      setDeleteConfirm({ type: "topic", id: topicId, institutionId, name });
    }
  };

  const handleDeleteMaterial = (materialId: string, name?: string) => {
    if (canDeleteMaterials) {
      setDeleteConfirm({ type: "material", id: materialId, name });
    }
  };

  const handleEditSubject = (args: {
    subjectId: string;
    subjectName: string;
    category: string | null;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => {
    if (!canManageSubjects || args.institutionId == null) return; // globals not editable
    setEditSubjectCtx({
      id: args.subjectId,
      name: args.subjectName,
      category: args.category,
      institutionId: args.institutionId,
      classId: args.classId,
      className: args.className,
    });
  };

  const handleDeleteSubject = (args: {
    subjectId: string;
    subjectName: string;
    institutionId: string | null;
    classId: string;
    className: string;
  }) => {
    if (!canManageSubjects) return;
    const kind: "hard" | "remove" = args.institutionId == null ? "remove" : "hard";
    setDeleteConfirm({
      type: "subject",
      kind,
      id: args.subjectId,
      name: args.subjectName,
      institutionId: args.institutionId,
      classId: args.classId,
      className: args.className,
    });
  };

  const handleConfirmDelete = () => {
    if (!deleteConfirm) return;
    if (!institutionId) return;
    const auditMeta = { institution_id: institutionId };

    if (deleteConfirm.type === "topic") {
      const name = deleteConfirm.name ?? null;
      if (deleteConfirm.institutionId === null) {
        hideGlobalTopic.mutate(deleteConfirm.id, {
          onSuccess: () =>
            logActivityEvent({
              action: "chapter_hidden",
              entityType: "Chapter",
              entityId: deleteConfirm.id,
              entityName: name,
              metadata: auditMeta,
            }),
        });
      } else {
        deleteTopic.mutate(deleteConfirm.id, {
          onSuccess: () =>
            logActivityEvent({
              action: "chapter_deleted",
              entityType: "Chapter",
              entityId: deleteConfirm.id,
              entityName: name,
              metadata: auditMeta,
            }),
        });
      }
    } else if (deleteConfirm.type === "material") {
      const name = deleteConfirm.name ?? null;
      deleteMaterial.mutate(deleteConfirm.id, {
        onSuccess: () =>
          logActivityEvent({
            action: "material_deleted",
            entityType: "Material",
            entityId: deleteConfirm.id,
            entityName: name,
            metadata: auditMeta,
          }),
      });
    } else if (deleteConfirm.type === "subject") {
      if (deleteConfirm.kind === "hard") {
        deleteSubject.mutate({
          subjectId: deleteConfirm.id,
          subjectName: deleteConfirm.name,
          institutionId,
          className: deleteConfirm.className,
        });
      } else {
        removeSubject.mutate({
          subjectId: deleteConfirm.id,
          subjectName: deleteConfirm.name,
          classId: deleteConfirm.classId,
          institutionId,
          className: deleteConfirm.className,
        });
      }
    }
    setDeleteConfirm(null);
  };

  // Tree view handlers
  const handleTreeAddTopic = (gradeId: string, subjectId: string, gradeName: string, subjectName: string) => {
    setAddTopicContext({ gradeId, subjectId, gradeName, subjectName });
    setIsAddTopicOpen(true);
  };

  const handleTreeAddMaterial = (topicId: string, topicName: string, gradeId: string, gradeName: string, subjectId: string, subjectName: string) => {
    setAddMaterialTreeContext({ topicId, topicName, gradeId, gradeName, subjectId, subjectName });
  };

  const handleManageSegments = (args: {
    classId: string;
    subjectId: string;
    subjectName: string;
    className: string;
  }) => setSegmentCtx(args);

  if (!institutionId) {
    return (
      <div className="h-full flex items-center justify-center">
        <Card className="p-8 text-center">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Institution Found</h2>
          <p className="text-muted-foreground">
            You are not associated with any institution. Please contact your administrator.
          </p>
        </Card>
      </div>
    );
  }

  const addNewMenuItems = [
    canAddSubjects && {
      label: "Add Subject",
      icon: <BookOpen className="h-4 w-4" />,
      onClick: () => setIsAddSchoolSubjectOpen(true),
    },
    canAddSubjects && {
      label: "Optional Groups",
      icon: <Layers className="h-4 w-4" />,
      onClick: () => setIsOptionalGroupsOpen(true),
    },
    canAddTopics && {
      label: "Add Chapter",
      icon: <Layers className="h-4 w-4" />,
      onClick: () => setIsAddSchoolTopicOpen(true),
    },
    canAddMaterials && {
      label: "Add Study Material",
      icon: <FileText className="h-4 w-4" />,
      onClick: () => setIsAddSchoolMaterialOpen(true),
    },
  ].filter(Boolean) as { label: string; icon: React.ReactNode; onClick: () => void }[];

  return (
    <PageShell
      fab={
        addNewMenuItems.length > 0 ? (
          <MobileFab
            label="Add New"
            icon={<Plus className="h-6 w-6" />}
            menuItems={addNewMenuItems}
          />
        ) : undefined
      }
    >
      <PageHeader
        icon={<BookOpen className="h-5 w-5" />}
        title="Syllabus & Study Materials"
        subtitle={
          roleInfo?.isSchoolAdmin
            ? "Manage subjects, chapters, and study materials for your institution"
            : roleInfo?.isCoordinator
              ? "View and manage syllabus for your wing classes"
              : "View and manage syllabus for your assigned classes"
        }
        primaryAction={
          addNewMenuItems.length > 0
            ? {
                label: "Add New",
                icon: <Plus className="h-4 w-4" />,
                menuItems: addNewMenuItems,
              }
            : undefined
        }
        secondaryActions={
          canManageSubjectsGlobally
            ? [
                {
                  label: "Bulk Upload",
                  icon: <Upload className="h-4 w-4" />,
                  onClick: () => setIsBulkUploadSubjectsTopicsOpen(true),
                },
              ]
            : []
        }
      />

      {/* Tree / Panel segmented control */}
      <div className="flex items-center gap-3 mt-2">
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(v) => v && setViewMode(v as ViewMode)}
          className="rounded-full border border-surface-stroke bg-[hsl(var(--surface-card)/0.85)] backdrop-blur-sm p-0.5"
        >
          <ToggleGroupItem
            value="tree"
            className="rounded-full px-4 h-9 data-[state=on]:bg-brand-primary data-[state=on]:text-white"
          >
            <Network className="h-4 w-4 mr-1" /> Tree
          </ToggleGroupItem>
          <ToggleGroupItem
            value="panel"
            className="rounded-full px-4 h-9 data-[state=on]:bg-brand-primary data-[state=on]:text-white"
          >
            <LayoutGrid className="h-4 w-4 mr-1" /> Panel
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Stats */}
      {/* The dashboard's clay tiles, as on the other admin pages (Naman,
          2026-10-07). Three in a row from sm up. */}
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
        <ClayStatTile label="Grades" value={grades.length} icon={<GraduationCap />} tone="teal" />
        <ClayStatTile label="Subjects" value={totalSubjects} icon={<BookOpen />} tone="violet" />
        <ClayStatTile label="Chapters" value={totalTopics} icon={<Layers />} tone="peach" />
      </div>

      {/* Main Content */}
      {viewMode === "tree" ? (
        /* Tree View */
        <Card className="mt-6 flex-1 min-h-0 overflow-hidden surface-card frosted-shadow rounded-card border-0">
          <SyllabusTreeView
            data={treeData}
            isLoading={treeLoading}
            onAddTopic={canAddTopics ? handleTreeAddTopic : undefined}
            onAddMaterial={canAddMaterials ? handleTreeAddMaterial : undefined}
            onDeleteGrade={undefined} // Grades are managed by super admin only
            onDeleteTopic={canDeleteTopics ? handleDeleteTopic : undefined}
            onDeleteMaterial={canDeleteMaterials ? handleDeleteMaterial : undefined}
            onEditSubject={canManageSubjects ? handleEditSubject : undefined}
            onDeleteSubject={canManageSubjects ? handleDeleteSubject : undefined}
            userId={user?.id ?? null}
            onReorderChapters={canAddTopics ? handleTreeReorderChapters : undefined}
            onManageSegments={
              isFeatureEnabled("syllabus_segmentation")
                ? handleManageSegments
                : undefined
            }
          />
        </Card>
      ) : (
        /* Panel View — see PanelLayout below for the dual mobile/desktop split. */
        (() => {
          // Compute the three panels' bodies + their "is the empty-state being
          // shown" flag once, so the mobile grid and the desktop resizable
          // group can both render them without duplication.
          const classesEmpty = !gradesLoading && filteredGrades.length === 0;
          const classesBody = gradesLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : classesEmpty ? (
            <SharedEmptyState
              size="sm"
              icon={<GraduationCap className="h-6 w-6" />}
              title="No classes available"
              description="Classes are configured by your school admin."
              tone="teal"
            />
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {filteredGrades.map((grade) => (
                  <GradeCard
                    key={grade.id}
                    id={grade.id}
                    gradeNumber={grade.grade_number}
                    gradeName={grade.grade_name}
                    subjectCount={grade.subject_count}
                    topicCount={grade.topic_count}
                    isSelected={selectedGrade?.id === grade.id}
                    onSelect={() => handleSelectGrade(grade)}
                  />
                ))}
              </AnimatePresence>
            </div>
          );

          const subjectsEmpty =
            !subjectsLoading && (!selectedGrade || filteredSubjects.length === 0);
          const subjectsBody = subjectsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !selectedGrade ? (
            <SharedEmptyState
              size="sm"
              icon={<FolderOpen className="h-6 w-6" />}
              title="Pick a class first"
              description="Choose a class from the left to see its subjects."
              tone="violet"
            />
          ) : filteredSubjects.length === 0 ? (
            <SharedEmptyState
              size="sm"
              icon={<BookOpen className="h-6 w-6" />}
              title="No subjects yet"
              description={
                canManageSubjectsGlobally
                  ? "Add subjects to this class to start building the syllabus."
                  : "No subjects assigned to this class."
              }
              tone="violet"
              action={
                canManageSubjectsGlobally
                  ? {
                      label: "Manage subjects",
                      icon: <Plus className="h-4 w-4" />,
                      onClick: () => setIsAssignSubjectsOpen(true),
                    }
                  : undefined
              }
            />
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="popLayout">
                {filteredSubjects.map((subject) => (
                  <SubjectCard
                    key={subject.id}
                    id={subject.id}
                    name={subject.name}
                    code={subject.code}
                    category={subject.category}
                    topicCount={subject.topic_count}
                    isSelected={selectedSubject?.id === subject.id}
                    isGlobal={subject.institution_id === null}
                    onSelect={() => handleSelectSubject(subject)}
                    onEdit={
                      canManageSubjects && subject.institution_id != null
                        ? () =>
                            handleEditSubject({
                              subjectId: subject.id,
                              subjectName: subject.name,
                              category: subject.category ?? null,
                              institutionId: subject.institution_id ?? null,
                              classId: selectedGrade!.id,
                              className: selectedGrade!.grade_name,
                            })
                        : undefined
                    }
                    onDelete={
                      canManageSubjects
                        ? () =>
                            handleDeleteSubject({
                              subjectId: subject.id,
                              subjectName: subject.name,
                              institutionId: subject.institution_id ?? null,
                              classId: selectedGrade!.id,
                              className: selectedGrade!.grade_name,
                            })
                        : undefined
                    }
                  />
                ))}
              </AnimatePresence>
            </div>
          );

          const chaptersEmpty =
            !topicsLoading && (!selectedSubject || filteredTopics.length === 0);
          const chaptersBody = topicsLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : !selectedSubject ? (
            <SharedEmptyState
              size="sm"
              icon={<Layers className="h-6 w-6" />}
              title="Pick a subject first"
              description="Choose a subject to see its chapters."
              tone="peach"
            />
          ) : filteredTopics.length === 0 ? (
            <SharedEmptyState
              size="sm"
              icon={<Layers className="h-6 w-6" />}
              title="No chapters yet"
              description={
                canAddTopics
                  ? "Add chapters to this subject. Start with the first one."
                  : "This subject has no chapters yet."
              }
              tone="peach"
              action={
                canAddTopics && selectedGrade
                  ? {
                      label: "Add chapter",
                      icon: <Plus className="h-4 w-4" />,
                      onClick: () => {
                        setAddTopicContext({
                          gradeId: selectedGrade.id,
                          gradeName: selectedGrade.grade_name,
                          subjectId: selectedSubject.id,
                          subjectName: selectedSubject.name,
                        });
                        setIsAddTopicOpen(true);
                      },
                    }
                  : undefined
              }
            />
          ) : (
            (() => {
              const renderRow = (topic: Topic, leadingSlot?: React.ReactNode) => (
                <TopicAccordion
                  id={topic.id}
                  topicName={topic.topic_name}
                  topicNameHindi={topic.topic_name_hindi}
                  difficultyLevel={topic.difficulty_level}
                  learningOutcomes={topic.learning_outcomes}
                  isGlobal={topic.institution_id == null}
                  materials={expandedTopicId === topic.id ? expandedTopicMaterials : []}
                  materialCount={topic.material_count}
                  isLoadingMaterials={expandedTopicId === topic.id && materialsLoading}
                  leadingSlot={leadingSlot}
                  onToggle={(topicId, isOpen) => setExpandedTopicId(isOpen ? topicId : null)}
                  onAddMaterial={
                    canAddMaterials && selectedGrade && selectedSubject
                      ? () =>
                          setAddMaterialContext({
                            topic,
                            gradeId: selectedGrade.id,
                            gradeName: selectedGrade.grade_name,
                            subjectId: selectedSubject.id,
                            subjectName: selectedSubject.name,
                          })
                      : undefined
                  }
                  onDeleteMaterial={canDeleteMaterials ? handleDeleteMaterial : undefined}
                  onDelete={
                    canDeleteTopics
                      ? () => handleDeleteTopic(topic.id, topic.institution_id, topic.topic_name)
                      : undefined
                  }
                />
              );

              return (
                <div className="space-y-2">
                  {reorderEnabled && topics.length > 1 && user?.id && (
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleResetTopicOrder}
                        className="h-auto gap-1.5 px-2 py-1 text-xs font-medium text-ink-500 hover:text-brand-primary hover:bg-transparent"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Reset order
                      </Button>
                    </div>
                  )}

                  {reorderEnabled ? (
                    <DndContext
                      sensors={dragSensors}
                      onDragStart={handleTopicDragStart}
                      onDragEnd={handleTopicDragEnd}
                      onDragCancel={() => setActiveDragId(null)}
                    >
                      <SortableContext items={topicOrderIds} strategy={verticalListSortingStrategy}>
                        <div className="space-y-2">
                          {topics.map((topic) => (
                            <SortableTopicRow
                              key={topic.id}
                              topicId={topic.id}
                              chapterName={topic.topic_name ?? "chapter"}
                            >
                              {(handle) => renderRow(topic, handle)}
                            </SortableTopicRow>
                          ))}
                        </div>
                      </SortableContext>
                      <DragOverlay>
                        {activeDragId
                          ? (() => {
                              const t = topics.find((x) => x.id === activeDragId);
                              return t ? (
                                <div className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-card-lg">
                                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-primary/10 text-brand-primary">
                                    <GripVertical className="h-5 w-5" />
                                  </div>
                                  <span className="font-medium text-ink-900">{t.topic_name}</span>
                                </div>
                              ) : null;
                            })()
                          : null}
                      </DragOverlay>
                    </DndContext>
                  ) : (
                    <div className="space-y-2">
                      {filteredTopics.map((topic) => (
                        <div key={topic.id}>{renderRow(topic)}</div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()
          );

          // Shared props per panel (everything except the wrapper-specific
          // className handed down by mobile / desktop layouts).
          const classesPanelProps = {
            tone: "teal" as const,
            eyebrow: "Step 1",
            title: "Classes",
            icon: <GraduationCap className="h-4 w-4" />,
            count: grades.length,
            search: {
              value: gradeSearch,
              onChange: setGradeSearch,
              placeholder: "Search classes...",
            },
            isEmpty: classesEmpty,
          };
          const subjectsPanelProps = {
            tone: "violet" as const,
            eyebrow: selectedGrade ? selectedGrade.grade_name : "Step 2",
            title: "Subjects",
            icon: <BookOpen className="h-4 w-4" />,
            count: selectedGrade ? gradeSubjects.length : undefined,
            search: {
              value: subjectSearch,
              onChange: setSubjectSearch,
              placeholder: "Search subjects...",
              disabled: !selectedGrade,
            },
            // "Manage" (assign subjects to this class) removed on request —
            // subject-to-class management lives on the /school/subjects page.
            // The empty-state "Manage subjects" adder (below) still covers a
            // class that has no subjects yet.
            isEmpty: subjectsEmpty,
          };
          const chaptersPanelProps = {
            tone: "peach" as const,
            eyebrow: selectedSubject ? selectedSubject.name : "Step 3",
            title: "Chapters",
            icon: <Layers className="h-4 w-4" />,
            count: selectedSubject ? topics.length : undefined,
            search: {
              value: topicSearch,
              onChange: setTopicSearch,
              placeholder: "Search chapters...",
              disabled: !selectedSubject,
            },
            headerAction:
              selectedGrade && selectedSubject ? (
                <div className="flex items-center gap-2">
                  {isFeatureEnabled("syllabus_segmentation") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setSegmentCtx({
                          classId: selectedGrade.id,
                          subjectId: selectedSubject.id,
                          subjectName: selectedSubject.name,
                          className: selectedGrade.grade_name,
                        })
                      }
                    >
                      <Layers className="h-4 w-4 mr-1" />
                      Parts
                    </Button>
                  )}
                  {canAddTopics && (
                    <Button
                      size="sm"
                      onClick={() => {
                        setAddTopicContext({
                          gradeId: selectedGrade.id,
                          gradeName: selectedGrade.grade_name,
                          subjectId: selectedSubject.id,
                          subjectName: selectedSubject.name,
                        });
                        setIsAddTopicOpen(true);
                      }}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      Add Chapter
                    </Button>
                  )}
                </div>
              ) : undefined,
            isEmpty: chaptersEmpty,
          };

          return (
            // mt-6 + viewport-relative height. Without an explicit height the
            // panels collapsed to their content height (because PageShell isn't
            // a flex column) — empty middle/right panels then looked like blank
            // page background. The min-h-[560px] floor keeps the workspace
            // usable on shorter screens.
            <div className="mt-6 flex flex-col min-h-[560px] lg:h-[calc(100dvh-260px)]">
              <SyllabusBreadcrumb
                gradeName={selectedGrade?.grade_name}
                subjectName={selectedSubject?.name}
                onNavigateToGrades={handleNavigateToGrades}
                onNavigateToSubjects={handleNavigateToSubjects}
              />

              {/* Mobile: the three steps stacked as full-width ROWS (each card
                  scrolls its own list internally). All three stay visible; the
                  page scrolls through them. */}
              <div className="lg:hidden mt-3 space-y-3">
                <div className="h-[55vh] min-h-[320px]">
                  <PanelCard {...classesPanelProps}>{classesBody}</PanelCard>
                </div>
                <div className="h-[55vh] min-h-[320px]">
                  <PanelCard {...subjectsPanelProps}>{subjectsBody}</PanelCard>
                </div>
                <div className="h-[55vh] min-h-[320px]">
                  <PanelCard {...chaptersPanelProps}>{chaptersBody}</PanelCard>
                </div>
              </div>

              {/* Desktop: resizable horizontal split. Default sizes mirror the
                  old lg:col-span 3/4/5; min sizes keep each panel readable.
                  The hidden/lg:flex toggle MUST live on this wrapper div, NOT on
                  ResizablePanelGroup — the group forces an inline display:flex
                  that overrides Tailwind `hidden`, leaking the desktop columns
                  onto mobile (the overlap bug). */}
              <div className="hidden lg:flex mt-3 flex-1 min-h-0">
              <ResizablePanelGroup
                direction="horizontal"
                className="flex-1 min-h-0"
              >
                <ResizablePanel defaultSize={26} minSize={18} maxSize={45}>
                  <div className="h-full pr-2">
                    <PanelCard {...classesPanelProps}>{classesBody}</PanelCard>
                  </div>
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  className="bg-transparent w-2 hover:bg-brand-primary/10 transition-colors"
                />
                <ResizablePanel defaultSize={34} minSize={20}>
                  <div className="h-full px-2">
                    <PanelCard {...subjectsPanelProps}>{subjectsBody}</PanelCard>
                  </div>
                </ResizablePanel>
                <ResizableHandle
                  withHandle
                  className="bg-transparent w-2 hover:bg-brand-primary/10 transition-colors"
                />
                <ResizablePanel defaultSize={40} minSize={25}>
                  <div className="h-full pl-2">
                    <PanelCard {...chaptersPanelProps}>{chaptersBody}</PanelCard>
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
              </div>
            </div>
          );
        })()
      )}

      {/* Dialogs */}
      {addTopicContext && (
        <AddTopicToSubjectDialog
          open={isAddTopicOpen}
          onOpenChange={(open) => {
            setIsAddTopicOpen(open);
            if (!open) setAddTopicContext(null);
          }}
          gradeId={addTopicContext.gradeId}
          gradeName={addTopicContext.gradeName}
          subjectId={addTopicContext.subjectId}
          subjectName={addTopicContext.subjectName}
          institutionId={institutionId} // Institute-specific topics for school users
        />
      )}

      {segmentCtx && (
        <SegmentManagerSheet
          open
          onOpenChange={(o) => {
            if (!o) setSegmentCtx(null);
          }}
          classId={segmentCtx.classId}
          subjectId={segmentCtx.subjectId}
          subjectName={segmentCtx.subjectName}
          className={segmentCtx.className}
          institutionId={institutionId ?? null}
          canManage={canAddTopics}
        />
      )}

      {addMaterialContext && (
        <AddMaterialToTopicDialog
          open={!!addMaterialContext}
          onOpenChange={(open) => {
            if (!open) setAddMaterialContext(null);
          }}
          topicId={addMaterialContext.topic.id}
          topicName={addMaterialContext.topic.topic_name}
          gradeId={addMaterialContext.gradeId}
          gradeName={addMaterialContext.gradeName}
          subjectId={addMaterialContext.subjectId}
          subjectName={addMaterialContext.subjectName}
        />
      )}

      {addMaterialTreeContext && (
        <AddMaterialToTopicDialog
          open={!!addMaterialTreeContext}
          onOpenChange={(open) => {
            if (!open) setAddMaterialTreeContext(null);
          }}
          topicId={addMaterialTreeContext.topicId}
          topicName={addMaterialTreeContext.topicName}
          gradeId={addMaterialTreeContext.gradeId}
          gradeName={addMaterialTreeContext.gradeName}
          subjectId={addMaterialTreeContext.subjectId}
          subjectName={addMaterialTreeContext.subjectName}
        />
      )}

      {selectedGrade && (
        <AssignSubjectsDialog
          open={isAssignSubjectsOpen}
          onOpenChange={setIsAssignSubjectsOpen}
          gradeId={selectedGrade.id}
          gradeName={selectedGrade.grade_name}
        />
      )}

      <BulkUploadSubjectsTopicsDialog
        open={isBulkUploadSubjectsTopicsOpen}
        onOpenChange={(open) => {
          setIsBulkUploadSubjectsTopicsOpen(open);
          if (!open) setPendingBulkUploadFile(null);
        }}
        initialFile={pendingBulkUploadFile}
        onInitialFileConsumed={() => setPendingBulkUploadFile(null)}
      />

      <BulkUploadMaterialsDialog
        open={isBulkUploadMaterialsOpen}
        onOpenChange={setIsBulkUploadMaterialsOpen}
      />

      {/* New Individual Add Dialogs */}
      {institutionId && (
        <>
          <AddSchoolSubjectDialog
            open={isAddSchoolSubjectOpen}
            onOpenChange={setIsAddSchoolSubjectOpen}
            institutionId={institutionId}
            coordinatorClassIds={
              effectiveRole === "coordinator" ? coordinatorClassIds : null
            }
          />
          <OptionalGroupsSheet
            open={isOptionalGroupsOpen}
            onOpenChange={setIsOptionalGroupsOpen}
            institutionId={institutionId}
          />
          <AddSchoolTopicDialog
            open={isAddSchoolTopicOpen}
            onOpenChange={setIsAddSchoolTopicOpen}
            institutionId={institutionId}
            teacherUserId={effectiveRole === "teacher" ? user?.id : null}
            coordinatorClassIds={
              effectiveRole === "coordinator" ? coordinatorClassIds : null
            }
          />
          <AddSchoolStudyMaterialDialog
            open={isAddSchoolMaterialOpen}
            onOpenChange={(open) => {
              setIsAddSchoolMaterialOpen(open);
              if (!open) {
                setPendingStudyMaterialFile(null);
                setPendingStudyMaterialContext(null);
              }
            }}
            institutionId={institutionId}
            teacherUserId={effectiveRole === "teacher" ? user?.id : null}
            initialFile={pendingStudyMaterialFile}
            onInitialFileConsumed={() => setPendingStudyMaterialFile(null)}
            initialContext={pendingStudyMaterialContext}
            onInitialContextConsumed={() => setPendingStudyMaterialContext(null)}
          />
        </>
      )}

      {editSubjectCtx && (
        <EditSubjectDialog
          open={!!editSubjectCtx}
          onOpenChange={(open) => {
            if (!open) setEditSubjectCtx(null);
          }}
          subject={{
            id: editSubjectCtx.id,
            name: editSubjectCtx.name,
            category: editSubjectCtx.category,
            institutionId: editSubjectCtx.institutionId,
          }}
          classId={editSubjectCtx.classId}
          className={editSubjectCtx.className}
        />
      )}
      {/* Full-screen drop overlay — appears while the user is dragging a file
          anywhere on the page. pointer-events-none so the underlying window
          drop listener still fires; the visual is purely confirmation. */}
      {isPageDragging && (
        <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center bg-brand-primary/10 backdrop-blur-sm">
          <div className="rounded-card surface-card frosted-shadow-lg px-8 py-6 border-2 border-dashed border-brand-primary text-center">
            <Upload className="h-10 w-10 text-brand-primary mx-auto mb-3" />
            <p className="text-base font-semibold text-ink-900">Drop to upload</p>
            <p className="text-xs text-ink-600 mt-1">
              {canManageSubjectsGlobally
                ? "CSV / Excel → bulk syllabus · PDF / image / video → study material"
                : "PDF, image, video, audio, or document → study material"}
            </p>
          </div>
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteConfirm?.type === "subject"
                ? deleteConfirm.kind === "hard"
                  ? "Delete Subject?"
                  : "Remove Subject from Class?"
                : `Delete ${deleteConfirm?.type === "topic" ? "Chapter" : "Material"}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm?.type === "subject"
                ? deleteConfirm.kind === "hard"
                  ? `This permanently deletes "${deleteConfirm.name}" and all its chapters for ${deleteConfirm.className}. Study materials and question-bank questions are kept but lose the subject tag. This can't be undone.`
                  : `This removes "${deleteConfirm.name}" from ${deleteConfirm.className}. It's a shared subject, so it stays available to other schools and can be added back later.`
                : `This action cannot be undone. This will permanently delete the ${deleteConfirm?.type}.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleteConfirm?.type === "subject" && deleteConfirm.kind === "remove" ? "Remove" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageShell>
  );
}
