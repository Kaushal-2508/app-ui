import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ClassSubject {
  id: string;
  name: string;
  code: string | null;
  source: "global" | "institute";
  /** Compulsory (false/undefined, default) vs optional (true) for this class. */
  is_optional?: boolean;
}

/**
 * Fetches subjects for a specific class from both repositories:
 * 1. Global subjects mapped to this class (via subject_class_mappings -> universal_subjects where institution_id IS NULL)
 * 2. Institute-specific subjects ALSO mapped to this class (via subject_class_mappings -> universal_subjects where institution_id matches)
 *
 * Preferred read path (Phase 2): resolve classes.class_group_id, then query
 * `subject_class_group_mappings`. Falls back to legacy per-section
 * `subject_class_mappings` if the class has no class_group_id or the
 * group-level query returns empty (legacy institutions where the Phase 1
 * backfill hasn't run yet).
 */
export function useClassSubjects(classId: string | null, institutionId: string) {
  return useQuery({
    queryKey: ["class-subjects", classId, institutionId],
    queryFn: async () => {
      if (!classId) return { global: [], institute: [], all: [] };

      let mappings:
        | Array<{
            subject_id: string;
            institution_id: string;
            is_optional: boolean | null;
            universal_subjects: {
              id: string;
              name: string;
              code: string | null;
              institution_id: string | null;
              is_active: boolean | null;
            } | null;
          }>
        | null = null;
      let mappingsError: unknown = null;

      // Phase 2 preferred path: look up class_group_id, then read group-level mappings.
      const { data: classRow } = await supabase
        .from("classes")
        .select("class_group_id")
        .eq("id", classId)
        .maybeSingle();

      const classGroupId = (classRow as { class_group_id: string | null } | null)?.class_group_id ?? null;

      if (classGroupId) {
        const groupResult = await supabase
          .from("subject_class_group_mappings" as never)
          .select(`
            subject_id,
            institution_id,
            is_optional,
            universal_subjects!inner(id, name, code, institution_id, is_active)
          `)
          .eq("class_group_id", classGroupId)
          .eq("institution_id", institutionId);

        mappings = (groupResult.data ?? null) as typeof mappings;
        mappingsError = groupResult.error;
      }

      // Fallback: legacy per-section read. Triggers when class has no group,
      // the group-level read errors (e.g. migration not applied yet), or
      // returns no rows.
      if (!mappings || mappings.length === 0) {
        const legacyResult = await supabase
          .from("subject_class_mappings")
          .select(`
            subject_id,
            institution_id,
            is_optional,
            universal_subjects!inner(id, name, code, institution_id, is_active)
          `)
          .eq("class_id", classId)
          .eq("institution_id", institutionId);

        mappings = legacyResult.data as typeof mappings;
        mappingsError = legacyResult.error;
      }

      if (mappingsError) {
        console.error("Error fetching subject mappings:", mappingsError);
        return { global: [], institute: [], all: [] };
      }

      // Process subjects from mappings - separate into global vs institute
      const globalSubjects: ClassSubject[] = [];
      const instituteSubjects: ClassSubject[] = [];
      const seenIds = new Set<string>();
      
      (mappings || []).forEach((m) => {
        if (!m.universal_subjects || seenIds.has(m.subject_id)) return;
        seenIds.add(m.subject_id);
        
        const subject: ClassSubject = {
          id: m.subject_id,
          name: m.universal_subjects.name,
          code: m.universal_subjects.code || null,
          source: m.universal_subjects.institution_id === null ? "global" : "institute",
          is_optional: m.is_optional ?? false,
        };
        
        // Global subjects have NULL institution_id
        if (m.universal_subjects.institution_id === null) {
          globalSubjects.push(subject);
        } else {
          // Institute-specific subjects have institution_id set
          instituteSubjects.push(subject);
        }
      });

      // Sort both lists alphabetically
      globalSubjects.sort((a, b) => a.name.localeCompare(b.name));
      instituteSubjects.sort((a, b) => a.name.localeCompare(b.name));

      // Combined list: global first, then institute
      const all: ClassSubject[] = [...globalSubjects, ...instituteSubjects];

      return {
        global: globalSubjects,
        institute: instituteSubjects,
        all,
      };
    },
    enabled: !!classId && !!institutionId,
  });
}

/**
 * Hook to invalidate class subjects cache
 */
export function useInvalidateClassSubjects() {
  const queryClient = useQueryClient();
  
  return (classId?: string, institutionId?: string) => {
    if (classId && institutionId) {
      queryClient.invalidateQueries({ queryKey: ["class-subjects", classId, institutionId] });
    } else {
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
    }
  };
}
