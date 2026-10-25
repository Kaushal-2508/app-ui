import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { sortClassRows } from "@/lib/classSort";

export interface ClassGroup {
  id: string;
  institution_id: string;
  name: string;
  grade_level_id: string | null;
  academic_year: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClassGroupWithSections extends ClassGroup {
  section_ids: string[];
  section_labels: (string | null)[];
  section_count: number;
}

export interface ClassGroupSection {
  id: string;
  class_group_id: string | null;
  institution_id: string;
  name: string;
  section: string | null;
  academic_year: string;
  is_active: boolean | null;
}

const LIST_KEY = "class-groups";
const SECTIONS_KEY = "class-group-sections";

// Pre-school class names → canonical grade_number stored in public.grade_levels.
// Pre Nursery = -4 (migration 20260513000000), Nursery = -3, LKG = -2, UKG = -1.
const LOWER_GRADE_NUMBER_BY_NAME: Record<string, number> = {
  prenursery: -4,
  nursery: -3,
  lkg: -2,
  ukg: -1,
};

function extractGradeNumber(name: string): number | null {
  const numMatch = name.match(/\d+/);
  if (numMatch) return parseInt(numMatch[0], 10);

  const key = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return LOWER_GRADE_NUMBER_BY_NAME[key] ?? null;
}

async function resolveGradeLevelId(name: string): Promise<string | null> {
  const gradeNumber = extractGradeNumber(name);
  if (gradeNumber === null) return null;

  const { data, error } = await supabase
    .from("grade_levels")
    .select("id")
    .eq("grade_number", gradeNumber)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data.id;
}

export function useInstitutionClassGroups(institutionId: string | null) {
  return useQuery({
    queryKey: [LIST_KEY, institutionId],
    queryFn: async (): Promise<ClassGroupWithSections[]> => {
      if (!institutionId) return [];

      const { data, error } = await supabase
        .from("v_class_groups_with_sections" as never)
        .select("*")
        .eq("institution_id", institutionId)
        .eq("group_is_active", true)
        .order("name", { ascending: true });

      if (error) throw error;
      const mapped = ((data ?? []) as unknown as Array<
        ClassGroupWithSections & { class_group_id: string; group_is_active: boolean }
      >).map((row) => ({
        id: row.class_group_id,
        institution_id: row.institution_id,
        name: row.name,
        grade_level_id: row.grade_level_id,
        academic_year: row.academic_year,
        is_active: row.group_is_active,
        created_at: row.created_at,
        updated_at: row.updated_at,
        section_ids: row.section_ids ?? [],
        section_labels: row.section_labels ?? [],
        section_count: row.section_count ?? 0,
      }));
      // Canonical platform-wide order: Nursery → LKG → UKG → Class 1 → … → 12.
      return sortClassRows(mapped, (g) => g.name);
    },
    enabled: !!institutionId,
  });
}

export function useClassGroupSections(groupId: string | null) {
  return useQuery({
    queryKey: [SECTIONS_KEY, groupId],
    queryFn: async (): Promise<ClassGroupSection[]> => {
      if (!groupId) return [];
      const { data, error } = await supabase
        .from("classes")
        .select("id, class_group_id, institution_id, name, section, academic_year, is_active")
        .eq("class_group_id", groupId)
        .eq("is_active", true)
        .order("section", { ascending: true, nullsFirst: false });

      if (error) throw error;
      return (data ?? []) as unknown as ClassGroupSection[];
    },
    enabled: !!groupId,
  });
}

export function useCreateClassGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      institution_id: string;
      name: string;
      academic_year: string;
      is_active?: boolean;
      initial_sections?: string[];
    }) => {
      const name = input.name.trim();
      if (!name) throw new Error("Class name is required.");
      const year = input.academic_year.trim();
      if (!year) throw new Error("Academic year is required.");

      const gradeLevelId = await resolveGradeLevelId(name);

      const { data: group, error: groupError } = await supabase
        .from("class_groups" as never)
        .insert({
          institution_id: input.institution_id,
          name,
          academic_year: year,
          grade_level_id: gradeLevelId,
          is_active: input.is_active ?? true,
        } as never)
        .select("*")
        .single();

      if (groupError) throw groupError;
      const groupRow = group as unknown as ClassGroup;

      const sections = (input.initial_sections ?? [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      if (sections.length > 0) {
        const { error: sectionsError } = await supabase.from("classes").insert(
          sections.map((section) => ({
            institution_id: input.institution_id,
            class_group_id: groupRow.id,
            name,
            section,
            academic_year: year,
            is_active: true,
          }))
        );
        if (sectionsError) throw sectionsError;
      }

      return groupRow;
    },
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY, group.institution_id] });
      queryClient.invalidateQueries({ queryKey: ["institution-classes", group.institution_id] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      toast.success("Class created");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't create the class.", context: "createClassGroup" }),
  });
}

export function useUpdateClassGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      name?: string;
      academic_year?: string;
      is_active?: boolean;
    }) => {
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) {
        const trimmed = input.name.trim();
        if (!trimmed) throw new Error("Class name cannot be blank.");
        updates.name = trimmed;
      }
      if (input.academic_year !== undefined) {
        const trimmed = input.academic_year.trim();
        if (!trimmed) throw new Error("Academic year cannot be blank.");
        updates.academic_year = trimmed;
      }
      if (input.is_active !== undefined) updates.is_active = input.is_active;

      const { data, error } = await supabase
        .from("class_groups" as never)
        .update(updates as never)
        .eq("id", input.id)
        .select("*")
        .single();
      if (error) throw error;
      return data as unknown as ClassGroup;
    },
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY, group.institution_id] });
      queryClient.invalidateQueries({ queryKey: [SECTIONS_KEY, group.id] });
      queryClient.invalidateQueries({ queryKey: ["institution-classes", group.institution_id] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      toast.success("Class updated");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the class.", context: "updateClassGroup" }),
  });
}

export function useAddSectionToClassGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      class_group_id: string;
      institution_id: string;
      class_name: string;
      academic_year: string;
      section: string;
    }) => {
      const section = input.section.trim();
      if (!section) throw new Error("Section label is required.");

      const { data, error } = await supabase
        .from("classes")
        .insert({
          institution_id: input.institution_id,
          class_group_id: input.class_group_id,
          name: input.class_name,
          section,
          academic_year: input.academic_year,
          is_active: true,
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as ClassGroupSection;
    },
    onSuccess: (section) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY, section.institution_id] });
      queryClient.invalidateQueries({ queryKey: [SECTIONS_KEY, section.class_group_id] });
      queryClient.invalidateQueries({ queryKey: ["institution-classes", section.institution_id] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      toast.success("Section added");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't add the section.", context: "addSectionToClassGroup" }),
  });
}

export function useDeleteClassGroup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; institution_id: string }) => {
      // classes.class_group_id is NOT NULL with FK ON DELETE SET NULL — we must
      // delete the child section rows first, otherwise the parent delete aborts
      // with a NOT NULL violation. Cascades from classes.id (class_assignments,
      // attendance_*, tt_slots, exam_classes, etc.) fire as those rows go.
      const { error: sectionsError } = await supabase
        .from("classes")
        .delete()
        .eq("class_group_id", input.id);
      if (sectionsError) throw sectionsError;

      const { error: groupError } = await supabase
        .from("class_groups" as never)
        .delete()
        .eq("id", input.id);
      if (groupError) throw groupError;

      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: [LIST_KEY, input.institution_id] });
      queryClient.invalidateQueries({ queryKey: [SECTIONS_KEY, input.id] });
      queryClient.invalidateQueries({ queryKey: ["institution-classes", input.institution_id] });
      queryClient.invalidateQueries({ queryKey: ["classes"] });
      queryClient.invalidateQueries({ queryKey: ["admin-institutions"] });
      toast.success("Class deleted");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't delete the class.", context: "deleteClassGroup" }),
  });
}
