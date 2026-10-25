import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

export interface SectionStudentForRoll {
  id: string;
  full_name: string;
  roll_number: string | null;
}

interface ClassAssignmentRow {
  user_id: string;
  profiles:
    | { id: string; full_name: string; roll_number: string | null }
    | { id: string; full_name: string; roll_number: string | null }[]
    | null;
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function compareRoll(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const an = Number(a);
  const bn = Number(b);
  if (!Number.isNaN(an) && !Number.isNaN(bn) && an !== bn) return an - bn;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function useSectionStudentsForRoll(classId: string | null) {
  return useQuery({
    queryKey: ["section-students-for-roll", classId],
    enabled: !!classId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SectionStudentForRoll[]> => {
      const { data, error } = await supabase
        .from("class_assignments")
        .select(
          "user_id, profiles!class_assignments_user_id_fkey(id, full_name, roll_number)"
        )
        .eq("class_id", classId as string)
        .eq("role", "student")
        // Explicit bound. PostgREST already truncates at 1000 silently; saying
        // it out loud means a section that somehow grows past this fails
        // visibly in review rather than quietly dropping students from the list.
        .range(0, 999);
      if (error) throw error;

      const rows = (data ?? []) as ClassAssignmentRow[];
      const students: SectionStudentForRoll[] = [];
      for (const row of rows) {
        const p = pickOne(row.profiles);
        if (!p) continue;
        students.push({
          id: p.id,
          full_name: p.full_name,
          roll_number: p.roll_number,
        });
      }
      students.sort((a, b) => {
        const r = compareRoll(a.roll_number, b.roll_number);
        if (r !== 0) return r;
        return a.full_name.localeCompare(b.full_name, undefined, {
          numeric: true,
          sensitivity: "base",
        });
      });
      return students;
    },
  });
}
