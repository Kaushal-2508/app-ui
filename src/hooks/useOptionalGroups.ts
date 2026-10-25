import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";
import { SECTION_OPTIONAL_CHOICES_KEY } from "@/hooks/useSectionOptionalChoices";

// =============================================================
// Optional Groups — "Optional 1 / Optional 2" elective baskets.
// A group is a named basket of subjects per class_group; students
// pick at most one subject per group. Choices persist in
// student_optional_enrollments so all existing exam/homework
// filtering keeps working. Spec:
// docs/superpowers/specs/2026-07-29-optional-groups-design.md
// =============================================================

export interface OptionalGroupRow {
  id: string;
  name: string;
  position: number;
  class_group_id: string;
  institution_id: string;
  subject_ids: string[];
  /** Same membership as `subject_ids`, with names, so a class list can show
   *  what is already configured without drilling into each class. */
  subjects: { id: string; name: string }[];
}

/** Every optional group of the institution with its subject memberships. */
export function useInstitutionOptionalGroups(institutionId: string | null) {
  return useQuery({
    queryKey: ["optional-groups", institutionId],
    enabled: !!institutionId,
    staleTime: 60_000,
    queryFn: async (): Promise<OptionalGroupRow[]> => {
      const { data, error } = await supabase
        .from("optional_groups")
        .select(
          "id, name, position, class_group_id, institution_id, optional_group_subjects(subject_id, universal_subjects(id, name))",
        )
        .eq("institution_id", institutionId as string)
        .order("position", { ascending: true })
        .range(0, 199);
      if (error) throw error;
      type Row = {
        id: string; name: string; position: number;
        class_group_id: string; institution_id: string;
        optional_group_subjects:
          | { subject_id: string; universal_subjects: { id: string; name: string } | null }[]
          | null;
      };
      return ((data ?? []) as unknown as Row[]).map((r) => {
        const links = r.optional_group_subjects ?? [];
        return {
          id: r.id,
          name: r.name,
          position: r.position,
          class_group_id: r.class_group_id,
          institution_id: r.institution_id,
          subject_ids: links.map((s) => s.subject_id),
          subjects: links
            .filter((s) => !!s.universal_subjects)
            .map((s) => ({ id: s.universal_subjects!.id, name: s.universal_subjects!.name }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        };
      });
    },
  });
}

function invalidateGroupCaches(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["optional-groups"] });
  queryClient.invalidateQueries({ queryKey: ["optional-groups-for-class"] });
  queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
  queryClient.invalidateQueries({ queryKey: ["student-subject-assignment"] });
  queryClient.invalidateQueries({ queryKey: ["student-optional-group-assignment"] });
  queryClient.invalidateQueries({ queryKey: [SECTION_OPTIONAL_CHOICES_KEY] });
}

/** Lazy-create (or fetch) the group row for (class_group, name). Returns the id. */
export function useUpsertOptionalGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { classGroupId: string; name: string }): Promise<string> => {
      const { data, error } = await supabase.rpc("upsert_optional_group", {
        _class_group_id: input.classGroupId,
        _name: input.name,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: (_id, input) => {
      invalidateGroupCaches(queryClient);
      void logActivityEvent({
        action: "optional_group_upserted",
        entityType: "OptionalGroup",
        entityName: input.name,
        metadata: { class_group_id: input.classGroupId },
      });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't create the optional group.", context: "upsertOptionalGroup" }),
  });
}

/** Add / remove a subject from a group (server enforces the invariants). */
export function useSetOptionalGroupSubject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { groupId: string; subjectId: string; member: boolean; subjectName?: string; groupName?: string }) => {
      const { error } = await supabase.rpc("set_optional_group_subject", {
        _group_id: input.groupId,
        _subject_id: input.subjectId,
        _member: input.member,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      invalidateGroupCaches(queryClient);
      void logActivityEvent({
        action: input.member ? "optional_group_subject_added" : "optional_group_subject_removed",
        entityType: "OptionalGroup",
        entityId: input.groupId,
        entityName: input.groupName,
        metadata: { subject_id: input.subjectId, subject_name: input.subjectName },
      });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the optional group.", context: "setOptionalGroupSubject" }),
  });
}

/**
 * Deletes a whole named optional ("Optional 3") across every class it covers.
 * `delete_optional_group` removes ONE class row, and a name spans one row per
 * class_group, so this walks the already-loaded id list (small - one entry per
 * class, and callers only reach here once the optional holds no subjects) and
 * refreshes the caches once instead of per row.
 */
export function useDeleteOptionalGroupsByName() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; groupIds: string[] }) => {
      for (const id of input.groupIds) {
        const { error } = await supabase.rpc("delete_optional_group", { _group_id: id });
        if (error) throw error;
      }
      return input;
    },
    onSuccess: (input) => {
      invalidateGroupCaches(queryClient);
      // Slots pointing at the group degrade to Free (FK SET NULL).
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace"] });
      toast.success(`"${input.name}" deleted`);
      void logActivityEvent({
        action: "optional_group_deleted",
        entityType: "OptionalGroup",
        entityName: input.name,
        metadata: { class_rows: input.groupIds.length },
      });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't delete this optional.", context: "deleteOptionalGroupsByName" }),
  });
}

export function useDeleteOptionalGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { groupId: string; groupName?: string }) => {
      const { error } = await supabase.rpc("delete_optional_group", { _group_id: input.groupId });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      invalidateGroupCaches(queryClient);
      // Slots pointing at the group degrade to Free (FK SET NULL) —
      // refresh open workspaces so the grid reflects it.
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "workspace"] });
      toast.success("Optional group deleted");
      void logActivityEvent({
        action: "optional_group_deleted",
        entityType: "OptionalGroup",
        entityId: input.groupId,
        entityName: input.groupName,
      });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't delete the optional group.", context: "deleteOptionalGroup" }),
  });
}

// -------------------------------------------------------------
// Slot drawer — groups available for a class (via its class_group)
// with each group's subjects and the subject's teacher IN THIS class.
// -------------------------------------------------------------
export interface OptionalGroupForClass {
  id: string;
  name: string;
  subjects: { subject_id: string; name: string; teacher_name: string | null }[];
}

export function useOptionalGroupsForClass(classId: string | null) {
  return useQuery({
    queryKey: ["optional-groups-for-class", classId],
    enabled: !!classId,
    staleTime: 60_000,
    queryFn: async (): Promise<OptionalGroupForClass[]> => {
      const { data: classRow, error: cErr } = await supabase
        .from("classes")
        .select("id, class_group_id")
        .eq("id", classId as string)
        .maybeSingle();
      if (cErr) throw cErr;
      const classGroupId = (classRow as { class_group_id: string | null } | null)?.class_group_id ?? null;
      if (!classGroupId) return [];

      const { data: groups, error: gErr } = await supabase
        .from("optional_groups")
        .select("id, name, position, optional_group_subjects(subject_id, universal_subjects(id, name))")
        .eq("class_group_id", classGroupId)
        .order("position", { ascending: true })
        .range(0, 49);
      if (gErr) throw gErr;
      type GroupRow = {
        id: string; name: string; position: number;
        optional_group_subjects: { subject_id: string; universal_subjects: { id: string; name: string } | null }[] | null;
      };
      const groupRows = (groups ?? []) as unknown as GroupRow[];
      if (groupRows.length === 0) return [];

      // One batched teacher lookup for every group subject (no N+1).
      const subjectIds = [
        ...new Set(groupRows.flatMap((g) => (g.optional_group_subjects ?? []).map((s) => s.subject_id))),
      ];
      const teacherBySubject = new Map<string, string>();
      if (subjectIds.length > 0) {
        const { data: teachers, error: tErr } = await supabase
          .from("class_assignments")
          .select("subject_id, profiles:profiles!class_assignments_user_id_fkey(full_name)")
          .eq("class_id", classId as string)
          .eq("role", "teacher")
          .in("subject_id", subjectIds)
          .range(0, 199);
        if (tErr) throw tErr;
        type TRow = { subject_id: string | null; profiles: { full_name: string | null } | null };
        for (const t of (teachers ?? []) as unknown as TRow[]) {
          if (t.subject_id && t.profiles?.full_name && !teacherBySubject.has(t.subject_id)) {
            teacherBySubject.set(t.subject_id, t.profiles.full_name);
          }
        }
      }

      return groupRows.map((g) => ({
        id: g.id,
        name: g.name,
        subjects: (g.optional_group_subjects ?? [])
          .filter((s) => !!s.universal_subjects)
          .map((s) => ({
            subject_id: s.subject_id,
            name: s.universal_subjects!.name,
            teacher_name: teacherBySubject.get(s.subject_id) ?? null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      }));
    },
  });
}

// -------------------------------------------------------------
// Student profile → Subjects tab
// -------------------------------------------------------------
export interface StudentOptionalGroup {
  group_id: string;
  name: string;
  position: number;
  subjects: { subject_id: string; name: string }[];
  chosen_subject_id: string | null;
}

export interface StudentOptionalGroupAssignment {
  can_manage: boolean;
  groups: StudentOptionalGroup[];
}

export function useStudentOptionalGroupAssignment(studentId: string | null) {
  return useQuery({
    queryKey: ["student-optional-group-assignment", studentId],
    enabled: !!studentId,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentOptionalGroupAssignment> => {
      const { data, error } = await supabase.rpc("get_student_optional_group_assignment", {
        _student: studentId as string,
      });
      if (error) throw error;
      const obj = (data ?? {}) as unknown as Partial<StudentOptionalGroupAssignment>;
      return {
        can_manage: obj.can_manage ?? false,
        // The RPC still returns a vestigial `chosen_classification` (always
        // 'main' since 20260730120000) — deliberately dropped here.
        groups: (obj.groups ?? []).map((g) => ({
          ...g,
          chosen_subject_id: g.chosen_subject_id ?? null,
        })),
      };
    },
  });
}

/** Saves every group choice in one transaction, then refreshes downstream caches. */
export function useSaveStudentOptionalGroupChoices() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      studentId: string;
      choices: { group_id: string; subject_id: string | null }[];
    }) => {
      const { error } = await supabase.rpc("set_student_optional_group_choices", {
        _student: input.studentId,
        _choices: input.choices as unknown as Json,
      });
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["student-optional-group-assignment", input.studentId] });
      queryClient.invalidateQueries({ queryKey: ["student-subject-assignment", input.studentId] });
      queryClient.invalidateQueries({ queryKey: ["student-visible-subjects", input.studentId] });
      // The section-wide picker (UpdateOptionalSubjectSheet) caches the same
      // rows per section; a per-student save must not leave it stale.
      queryClient.invalidateQueries({ queryKey: [SECTION_OPTIONAL_CHOICES_KEY] });
      // Downstream student-facing caches (same set the P1 toggle refreshes).
      queryClient.invalidateQueries({ queryKey: ["student-eligible-exams"] });
      queryClient.invalidateQueries({ queryKey: ["student-results"] });
      queryClient.invalidateQueries({ queryKey: ["student-homework"] });
      queryClient.invalidateQueries({ queryKey: ["timetable-v2", "student-week"] });
      toast.success("Optional subjects saved");
      void logActivityEvent({
        action: "optional_group_choices_saved",
        entityType: "StudentOptionalSubject",
        entityId: input.studentId,
        metadata: { choices: JSON.stringify(input.choices) },
      });
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't save this student's optional subjects.",
        context: "saveStudentOptionalGroupChoices",
      }),
  });
}
