import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";

export type ScopeMode = "section" | "multi" | "class";

export interface SectionOption {
  class_id: string;
  name: string;
  section: string | null;
  subjectMatches: boolean;
}

/**
 * Encapsulates the per-upload question scope picker (Phase 3 of the
 * class-groups refactor).
 *
 * Inputs: the teacher's current section + subject context.
 * Outputs: the resolved class_group_id, the list of sibling sections the
 * user can choose from, the currently selected mode + section ids, and a
 * helper that converts the choice into the scope_class_ids array expected
 * by insert_question_with_scope RPC / question_bank_section_scope rows.
 *
 * Scope semantics (matches RLS):
 *   - mode="section": scope = [currentClassId]
 *   - mode="multi":   scope = user-selected ids
 *   - mode="class":   scope = []   (zero rows = class-wide for the group)
 */
export function useQuestionScope(params: {
  institutionId: string | undefined;
  classId: string | undefined;
  subjectId: string | undefined;
}) {
  const { institutionId, classId, subjectId } = params;
  const { user } = useAuth();
  const { data: roleInfo } = useUserRole();
  const isAdmin =
    !!roleInfo?.isSchoolAdmin ||
    !!roleInfo?.isSuperAdmin ||
    !!roleInfo?.isSuperSchoolAdmin;
  const isTeacher = !!roleInfo?.isTeacher;

  // 1. Resolve the class_group_id for the current section.
  const groupQuery = useQuery({
    queryKey: ["question-scope-group", classId],
    enabled: !!classId,
    queryFn: async (): Promise<string | null> => {
      const { data } = await supabase
        .from("classes")
        .select("class_group_id")
        .eq("id", classId!)
        .maybeSingle();
      return (data as { class_group_id: string | null } | null)?.class_group_id ?? null;
    },
  });

  const classGroupId = groupQuery.data ?? null;

  // 2. Fetch sibling sections in the same class_group.
  // Admins see every section; teachers see only sections where they have
  // a class_assignments row (so "Multiple sections I teach" is accurate).
  const siblingsQuery = useQuery({
    queryKey: [
      "question-scope-siblings",
      institutionId,
      classGroupId,
      subjectId,
      isAdmin,
      user?.id,
    ],
    enabled: !!institutionId && !!classGroupId,
    queryFn: async (): Promise<SectionOption[]> => {
      const { data: sections, error } = await supabase
        .from("classes")
        .select("id, name, section, is_active")
        .eq("institution_id", institutionId!)
        .eq("class_group_id", classGroupId!)
        .neq("is_active", false)
        .order("section", { ascending: true, nullsFirst: false });

      if (error) throw error;

      const rows = (sections ?? []) as Array<{
        id: string;
        name: string;
        section: string | null;
      }>;

      if (isAdmin) {
        return rows.map((r) => ({
          class_id: r.id,
          name: r.name,
          section: r.section,
          subjectMatches: true,
        }));
      }

      if (!isTeacher || !user?.id) {
        return rows
          .filter((r) => r.id === classId)
          .map((r) => ({
            class_id: r.id,
            name: r.name,
            section: r.section,
            subjectMatches: true,
          }));
      }

      const { data: assignments } = await supabase
        .from("class_assignments")
        .select("class_id, subject_id")
        .eq("user_id", user.id)
        .eq("role", "teacher");

      const assignmentsByClass = new Map<string, Set<string | null>>();
      (assignments ?? []).forEach((a: { class_id: string; subject_id: string | null }) => {
        const set = assignmentsByClass.get(a.class_id) ?? new Set<string | null>();
        set.add(a.subject_id);
        assignmentsByClass.set(a.class_id, set);
      });

      return rows
        .filter((r) => assignmentsByClass.has(r.id) || r.id === classId)
        .map((r) => {
          const subs = assignmentsByClass.get(r.id);
          const subjectMatches =
            r.id === classId || !subjectId
              ? true
              : !!subs && (subs.has(subjectId) || subs.size === 0);
          return {
            class_id: r.id,
            name: r.name,
            section: r.section,
            subjectMatches,
          };
        });
    },
  });

  const siblings = siblingsQuery.data ?? [];

  // 3. localStorage-backed last-used mode per user.
  const storageKey = useMemo(
    () => (user?.id ? `salci:question-scope-mode:${user.id}` : null),
    [user?.id],
  );

  const [mode, setModeState] = useState<ScopeMode>("section");
  const [selectedSectionIds, setSelectedSectionIds] = useState<string[]>(
    classId ? [classId] : [],
  );

  // Hydrate from storage.
  useEffect(() => {
    if (!storageKey) return;
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved === "section" || saved === "multi" || saved === "class") {
        setModeState(saved);
      }
    } catch {
      // private mode / quota — ignore
    }
  }, [storageKey]);

  // Reset section selection whenever the current section changes
  // so "section" mode always has the current class_id.
  useEffect(() => {
    if (!classId) return;
    setSelectedSectionIds((prev) => {
      if (mode === "section") return [classId];
      if (mode === "multi") {
        return prev.includes(classId) ? prev : [classId, ...prev];
      }
      return prev;
    });
  }, [classId, mode]);

  const setMode = (next: ScopeMode) => {
    setModeState(next);
    try {
      if (storageKey) localStorage.setItem(storageKey, next);
    } catch {
      // ignore
    }
    if (next === "section" && classId) {
      setSelectedSectionIds([classId]);
    } else if (next === "class") {
      setSelectedSectionIds([]);
    } else if (next === "multi" && classId) {
      setSelectedSectionIds((prev) =>
        prev.includes(classId) ? prev : [classId, ...prev],
      );
    }
  };

  const toggleSection = (sectionClassId: string) => {
    setSelectedSectionIds((prev) =>
      prev.includes(sectionClassId)
        ? prev.filter((id) => id !== sectionClassId)
        : [...prev, sectionClassId],
    );
  };

  const resolveScopeClassIds = (): string[] => {
    if (mode === "class") return [];
    if (mode === "section") return classId ? [classId] : [];
    // multi: drop duplicates and ensure current class stays in
    const dedup = Array.from(new Set(selectedSectionIds));
    return dedup.length > 0 ? dedup : classId ? [classId] : [];
  };

  return {
    classGroupId,
    siblings,
    isLoadingSiblings: siblingsQuery.isLoading,
    mode,
    setMode,
    selectedSectionIds,
    toggleSection,
    setSelectedSectionIds,
    resolveScopeClassIds,
    /** True when the picker has enough data to commit a scope choice. */
    isReady: !!classGroupId,
    /** True if only one section exists — the picker can collapse. */
    isSingletonGroup: siblings.length <= 1,
  };
}

/**
 * Insert section-scope rows for a set of question_bank ids. Pass an empty
 * array to mean "class-wide pool" — nothing is inserted.
 */
export async function applyQuestionScope(
  questionIds: string[],
  scopeClassIds: string[],
): Promise<void> {
  if (questionIds.length === 0 || scopeClassIds.length === 0) return;
  const rows = questionIds.flatMap((qid) =>
    scopeClassIds.map((cid) => ({ question_id: qid, class_id: cid })),
  );
  const { error } = await supabase
    .from("question_bank_section_scope" as never)
    .insert(rows as never);
  if (error) {
    console.error("Failed to apply question scope:", error);
    throw error;
  }
}
