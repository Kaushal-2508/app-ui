import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NonSalciSchoolStatus =
  | "enrollment_open"
  | "enrollment_closed"
  | "batches_scheduled"
  | "exam_in_progress"
  | "results_published"
  | "archived";

export type NonSalciSchoolRow = {
  id: string;
  campaign_id: string;
  institution_id: string;
  institution_name: string;
  school_short_code: string;
  city: string | null;
  state: string | null;
  status: NonSalciSchoolStatus;
  student_count: number;
  teacher_count: number;
  created_at: string;
};

/**
 * Super-admin list of every "Non-SALCI" school — i.e. schools onboarded purely
 * for the Olympiad (`oly_schools.is_existing_salci_school = false`). Super
 * admins read `oly_*` directly via the `super_admin all` RLS policies.
 *
 * Counts are computed with per-school `head:true` COUNT queries rather than a
 * single `.in(...)` select so they stay accurate past the PostgREST 1000-row
 * cap (§23). The onboarded-school set is small, so the fan-out is cheap.
 */
export function useNonSalciSchools() {
  return useQuery({
    queryKey: ["olympiad", "non-salci-schools"],
    queryFn: async (): Promise<NonSalciSchoolRow[]> => {
      const { data: schools, error } = await supabase
        .from("oly_schools")
        .select(
          "id, campaign_id, institution_id, school_short_code, city, state, status, created_at, institutions(name)",
        )
        .eq("is_existing_salci_school", false)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const rows = schools ?? [];
      return Promise.all(
        rows.map(async (s) => {
          const [studentRes, teacherRes] = await Promise.all([
            supabase
              .from("oly_students")
              .select("id", { count: "exact", head: true })
              .eq("oly_school_id", s.id)
              .neq("status", "removed"),
            supabase
              .from("oly_teacher_class_assignments")
              .select("teacher_profile_id")
              .eq("oly_school_id", s.id),
          ]);
          const teacherIds = new Set(
            (teacherRes.data ?? []).map((t) => t.teacher_profile_id),
          );
          const inst = Array.isArray(s.institutions)
            ? s.institutions[0]
            : s.institutions;
          return {
            id: s.id,
            campaign_id: s.campaign_id,
            institution_id: s.institution_id,
            institution_name: (inst as { name?: string } | null)?.name ?? "(unknown)",
            school_short_code: s.school_short_code,
            city: s.city,
            state: s.state,
            status: s.status as NonSalciSchoolStatus,
            student_count: studentRes.count ?? 0,
            teacher_count: teacherIds.size,
            created_at: s.created_at,
          };
        }),
      );
    },
    staleTime: 60_000,
  });
}

export type NonSalciSchoolHeader = {
  id: string;
  institution_name: string;
  school_short_code: string;
  city: string | null;
  state: string | null;
  status: NonSalciSchoolStatus;
  campaign_id: string;
  student_count: number;
  teacher_count: number;
};

/** Single Non-SALCI school header + counts, for the detail page (deep-link safe). */
export function useNonSalciSchool(olySchoolId: string | undefined) {
  return useQuery({
    queryKey: ["olympiad", "non-salci-school", olySchoolId],
    queryFn: async (): Promise<NonSalciSchoolHeader | null> => {
      if (!olySchoolId) return null;
      const { data, error } = await supabase
        .from("oly_schools")
        .select(
          "id, school_short_code, city, state, status, campaign_id, institutions(name)",
        )
        .eq("id", olySchoolId)
        .eq("is_existing_salci_school", false)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const [studentRes, teacherRes] = await Promise.all([
        supabase
          .from("oly_students")
          .select("id", { count: "exact", head: true })
          .eq("oly_school_id", olySchoolId)
          .neq("status", "removed"),
        supabase
          .from("oly_teacher_class_assignments")
          .select("teacher_profile_id")
          .eq("oly_school_id", olySchoolId),
      ]);
      const teacherIds = new Set(
        (teacherRes.data ?? []).map((t) => t.teacher_profile_id),
      );

      const inst = Array.isArray(data.institutions)
        ? data.institutions[0]
        : data.institutions;
      return {
        id: data.id,
        institution_name: (inst as { name?: string } | null)?.name ?? "(unknown)",
        school_short_code: data.school_short_code,
        city: data.city,
        state: data.state,
        status: data.status as NonSalciSchoolStatus,
        campaign_id: data.campaign_id,
        student_count: studentRes.count ?? 0,
        teacher_count: teacherIds.size,
      };
    },
    enabled: !!olySchoolId,
    staleTime: 60_000,
  });
}
