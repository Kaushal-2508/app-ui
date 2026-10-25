import { useInfiniteQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type NonSalciStudentRow = {
  id: string;
  full_name: string;
  roll_number: string;
  admission_number: string | null;
  class_label: string;
  section_label: string | null;
  subject_ids: string[];
  parent_name: string;
  parent_phone: string;
  parent_email: string | null;
  enrollment_channel: string;
  status: string;
  date_of_birth: string;
  enrolled_at: string;
};

const PAGE_SIZE = 50;

type StudentPage = { rows: NonSalciStudentRow[]; nextCursor: string | null };

/**
 * Paginated student roster for one Non-SALCI school (super-admin view).
 * Cursor pagination on `enrolled_at` keeps every page bounded (§23) — never a
 * single unbounded fetch that the PostgREST 1000-row cap would silently
 * truncate.
 */
export function useNonSalciSchoolStudents(olySchoolId: string | undefined) {
  return useInfiniteQuery({
    queryKey: ["olympiad", "non-salci-students", olySchoolId],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }): Promise<StudentPage> => {
      if (!olySchoolId) return { rows: [], nextCursor: null };
      let q = supabase
        .from("oly_students")
        .select(
          "id, full_name, roll_number, admission_number, class_label, section_label, subject_ids, parent_name, parent_phone, parent_email, enrollment_channel, status, date_of_birth, enrolled_at",
        )
        .eq("oly_school_id", olySchoolId)
        .order("enrolled_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (pageParam) q = q.lt("enrolled_at", pageParam);
      const { data, error } = await q;
      if (error) throw error;
      const rows: NonSalciStudentRow[] = (data ?? []).map((r) => ({
        id: r.id,
        full_name: r.full_name,
        roll_number: r.roll_number,
        admission_number: r.admission_number,
        class_label: r.class_label,
        section_label: r.section_label,
        subject_ids: r.subject_ids ?? [],
        parent_name: r.parent_name,
        parent_phone: r.parent_phone,
        parent_email: r.parent_email,
        enrollment_channel: r.enrollment_channel,
        status: r.status,
        date_of_birth: r.date_of_birth,
        enrolled_at: r.enrolled_at,
      }));
      const nextCursor =
        rows.length === PAGE_SIZE ? rows[rows.length - 1].enrolled_at : null;
      return { rows, nextCursor };
    },
    getNextPageParam: (last) => last.nextCursor,
    enabled: !!olySchoolId,
    staleTime: 30_000,
  });
}
