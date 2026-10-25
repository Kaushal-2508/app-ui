import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";

export interface StudyMaterial {
  id: string;
  title: string;
  publisher: string | null;
  material_type: string;
  file_url: string | null;
  external_link: string | null;
  description: string | null;
  subject_id: string;
  grade_level_id: string;
  institution_id: string | null;
  is_active: boolean;
  created_at: string;
  subject_name?: string;
  grade_name?: string;
  grade_number?: number;
}

// Helper to fetch materials with joined data
async function fetchMaterialsWithJoins(filters?: {
  gradeId?: string;
  subjectId?: string;
  search?: string;
  activeOnly?: boolean;
  institutionId?: string;
}): Promise<StudyMaterial[]> {
  let query = supabase
    .from("study_materials")
    .select("*")
    .order("created_at", { ascending: false });

  // Filter by institution for data isolation
  if (filters?.institutionId) {
    query = query.or(`institution_id.eq.${filters.institutionId},institution_id.is.null`);
  }

  if (filters?.gradeId && filters.gradeId !== "all") {
    query = query.eq("grade_level_id", filters.gradeId);
  }
  if (filters?.subjectId && filters.subjectId !== "all") {
    query = query.eq("subject_id", filters.subjectId);
  }
  if (filters?.search) {
    query = query.ilike("title", `%${filters.search}%`);
  }
  if (filters?.activeOnly) {
    query = query.eq("is_active", true);
  }

  const { data: materials, error } = await query.limit(200);
  if (error) throw error;
  if (!materials || materials.length === 0) return [];

  // Get unique IDs
  const subjectIds = [...new Set(materials.map(m => m.subject_id))];
  const gradeIds = [...new Set(materials.map(m => m.grade_level_id))];

  // Fetch subjects and grades
  const [{ data: subjects }, { data: grades }] = await Promise.all([
    supabase.from("universal_subjects").select("id, name, code").in("id", subjectIds),
    supabase.from("grade_levels").select("id, grade_name, grade_number").in("id", gradeIds),
  ]);

  const subjectMap = new Map(subjects?.map(s => [s.id, s]) || []);
  const gradeMap = new Map(grades?.map(g => [g.id, g]) || []);

  return materials.map(m => ({
    ...m,
    subject_name: subjectMap.get(m.subject_id)?.name,
    grade_name: gradeMap.get(m.grade_level_id)?.grade_name,
    grade_number: gradeMap.get(m.grade_level_id)?.grade_number,
  }));
}

// Fetch all study materials (admin)
export function useStudyMaterials(filters?: {
  gradeId?: string;
  subjectId?: string;
  search?: string;
  institutionId?: string;
}) {
  return useQuery({
    queryKey: ["study-materials", filters],
    queryFn: () => fetchMaterialsWithJoins(filters),
  });
}

// Fetch study materials for students (filtered by their class/grade)
export function useStudentStudyMaterials(gradeId?: string, subjectId?: string, search?: string) {
  return useQuery({
    queryKey: ["student-study-materials", gradeId, subjectId, search],
    queryFn: () => fetchMaterialsWithJoins({ 
      gradeId, 
      subjectId, 
      search, 
      activeOnly: true 
    }),
  });
}

// Add study material
export function useAddStudyMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (material: {
      title: string;
      publisher?: string;
      material_type: string;
      file_url?: string;
      external_link?: string;
      description?: string;
      subject_id: string;
      grade_level_id: string;
      institution_id?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("study_materials")
        .insert({
          title: material.title,
          publisher: material.publisher || null,
          material_type: material.material_type,
          file_url: material.file_url || null,
          external_link: material.external_link || null,
          description: material.description || null,
          subject_id: material.subject_id,
          grade_level_id: material.grade_level_id,
          institution_id: material.institution_id || null,
          created_by: user.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-materials"] });
      queryClient.invalidateQueries({ queryKey: ["student-study-materials"] });
      toast.success("Study material added successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the study material.", context: "addStudyMaterial" });
    },
  });
}

// Update study material
export function useUpdateStudyMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...material }: {
      id: string;
      title?: string;
      publisher?: string;
      material_type?: string;
      file_url?: string;
      external_link?: string;
      description?: string;
      subject_id?: string;
      grade_level_id?: string;
      is_active?: boolean;
    }) => {
      const { data, error } = await supabase
        .from("study_materials")
        .update(material)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-materials"] });
      queryClient.invalidateQueries({ queryKey: ["student-study-materials"] });
      toast.success("Study material updated successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't update the study material.", context: "updateStudyMaterial" });
    },
  });
}

// Delete study material
export function useDeleteStudyMaterial() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("study_materials")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-materials"] });
      queryClient.invalidateQueries({ queryKey: ["student-study-materials"] });
      toast.success("Study material deleted successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the study material.", context: "deleteStudyMaterial" });
    },
  });
}

// Fetch universal subjects
export function useUniversalSubjects() {
  return useQuery({
    queryKey: ["universal-subjects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .select("*")
        .order("display_order");
      if (error) throw error;
      return data;
    },
  });
}

// Add universal subject
export function useAddUniversalSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (subject: {
      name?: string;
      name_hindi?: string;
      code?: string;
      category?: string;
    }) => {
      const { data, error } = await supabase
        .from("universal_subjects")
        .insert({
          name: subject.name || null,
          name_hindi: subject.name_hindi || null,
          code: subject.code || null,
          category: subject.category || null,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["universal-subjects"] });
      toast.success("Subject added successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the subject.", context: "addUniversalSubject" });
    },
  });
}

// Delete universal subject
export function useDeleteUniversalSubject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("universal_subjects")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["universal-subjects"] });
      toast.success("Subject deleted successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the subject.", context: "deleteUniversalSubject" });
    },
  });
}

// Add grade level
export function useAddGradeLevel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (grade: {
      grade_number: number;
      grade_name: string;
      display_order?: number;
    }) => {
      const { data, error } = await supabase
        .from("grade_levels")
        .insert({
          grade_number: grade.grade_number,
          grade_name: grade.grade_name,
          display_order: grade.display_order || grade.grade_number,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grade-levels"] });
      toast.success("Grade added successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't add the grade.", context: "addGradeLevel" });
    },
  });
}

// Delete grade level
export function useDeleteGradeLevel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("grade_levels")
        .delete()
        .eq("id", id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["grade-levels"] });
      toast.success("Grade deleted successfully");
    },
    onError: (error: Error) => {
      toastError(error, { fallback: "Couldn't delete the grade.", context: "deleteGradeLevel" });
    },
  });
}
