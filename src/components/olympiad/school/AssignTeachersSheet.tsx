import { useEffect, useRef, useState } from "react";
import { Loader2, Users } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MobileSheet } from "@/components/shared/sheets/MobileSheet";
import { useAssignOlympiadTeachers } from "@/hooks/olympiad/useAssignOlympiadTeachers";
import { useOlympiadTeachers } from "@/hooks/olympiad/useOlympiadTeachers";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GradeLevel = {
  id: string;
  grade_name: string;
  display_order: number | null;
};

type InstitutionTeacher = {
  id: string;
  full_name: string;
  email: string | null;
};

// ---------------------------------------------------------------------------
// Internal hooks
// ---------------------------------------------------------------------------

function useInstitutionIdForOlySchool(olySchoolId: string) {
  return useQuery({
    queryKey: ["oly-school", "institution-id", olySchoolId],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from("oly_schools")
        .select("institution_id")
        .eq("id", olySchoolId)
        .maybeSingle();
      if (error) throw error;
      return (data as { institution_id?: string } | null)?.institution_id ?? null;
    },
    enabled: !!olySchoolId,
    staleTime: 5 * 60_000,
  });
}

function useInstitutionTeachers(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-teachers", institutionId],
    queryFn: async (): Promise<InstitutionTeacher[]> => {
      if (!institutionId) return [];
      const { data, error } = await supabase
        .from("user_roles")
        .select("user_id, profiles!user_id ( id, full_name, email )")
        .eq("institution_id", institutionId)
        .eq("role", "teacher");
      if (error) throw error;
      return (data ?? []).map((r) => {
        const prof = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
        return {
          id: r.user_id,
          full_name: (prof as { full_name?: string } | null)?.full_name ?? "(unknown)",
          email: (prof as { email?: string | null } | null)?.email ?? null,
        };
      });
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });
}

function useParticipatingGrades(participatingGradeIds: string[]) {
  return useQuery({
    queryKey: ["grade-levels", "participating", participatingGradeIds],
    queryFn: async (): Promise<GradeLevel[]> => {
      if (participatingGradeIds.length === 0) return [];
      const { data, error } = await supabase
        .from("grade_levels")
        .select("id, grade_name, display_order")
        .in("id", participatingGradeIds)
        .order("display_order");
      if (error) throw error;
      return (data ?? []) as GradeLevel[];
    },
    enabled: participatingGradeIds.length > 0,
    staleTime: 5 * 60_000,
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type Props = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  olySchoolId: string;
  participatingGradeIds: string[];
};

/**
 * Assign existing SALCI teachers to Olympiad grade-level classes.
 * Lists all institution teachers, lets admin check which grade levels
 * each should cover, then calls oly-assign-existing-teachers.
 */
export function AssignTeachersSheet({
  open,
  onOpenChange,
  olySchoolId,
  participatingGradeIds,
}: Props) {
  const assign = useAssignOlympiadTeachers();
  const { data: institutionId } = useInstitutionIdForOlySchool(olySchoolId);
  const { data: institutionTeachers, isLoading: teachersLoading } =
    useInstitutionTeachers(institutionId ?? null);
  const { data: currentAssignments } = useOlympiadTeachers(olySchoolId);
  const { data: grades } = useParticipatingGrades(participatingGradeIds);

  // Map: teacher_profile_id → Set<grade_level_id>
  const [selections, setSelections] = useState<Map<string, Set<string>>>(new Map());
  const initialSelectionsRef = useRef<Map<string, Set<string>>>(new Map());

  // Populate selections from current assignments when sheet opens
  useEffect(() => {
    if (!open) {
      setSelections(new Map());
      initialSelectionsRef.current = new Map();
      return;
    }
    if (currentAssignments && currentAssignments.length > 0) {
      const initial = new Map<string, Set<string>>();
      for (const t of currentAssignments) {
        initial.set(t.teacher_profile_id, new Set(t.grade_level_ids));
      }
      setSelections(initial);
      initialSelectionsRef.current = initial;
    }
  }, [open, currentAssignments]);

  const isDirty = (() => {
    for (const [tid, gradeSet] of selections) {
      const initial = initialSelectionsRef.current.get(tid);
      if (!initial) return true;
      if (initial.size !== gradeSet.size) return true;
      for (const gid of gradeSet) {
        if (!initial.has(gid)) return true;
      }
    }
    for (const [tid] of initialSelectionsRef.current) {
      if (!selections.has(tid)) return true;
    }
    return false;
  })();

  const toggleGrade = (teacherId: string, gradeId: string, checked: boolean) => {
    setSelections((prev) => {
      const next = new Map(prev);
      const gradeSet = new Set(next.get(teacherId) ?? []);
      if (checked) {
        gradeSet.add(gradeId);
      } else {
        gradeSet.delete(gradeId);
      }
      if (gradeSet.size === 0) {
        next.delete(teacherId);
      } else {
        next.set(teacherId, gradeSet);
      }
      return next;
    });
  };

  const onSubmit = async () => {
    const assignments = Array.from(selections.entries())
      .filter(([, gradeSet]) => gradeSet.size > 0)
      .map(([teacher_profile_id, gradeSet]) => ({
        teacher_profile_id,
        grade_level_ids: Array.from(gradeSet),
      }));
    if (assignments.length === 0) return;
    try {
      await assign.mutateAsync({ oly_school_id: olySchoolId, assignments });
      onOpenChange(false);
    } catch {
      // toastError fires via useAssignOlympiadTeachers onError
    }
  };

  const hasSelections = (() => {
    for (const gradeSet of selections.values()) {
      if (gradeSet.size > 0) return true;
    }
    return false;
  })();

  return (
    <MobileSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Assign Olympiad Teachers"
      subtitle="Pick existing SALCI teachers and assign them to Olympiad classes"
      icon={<Users className="h-4 w-4" />}
      primaryAction={{
        label: "Save assignments",
        onClick: () => void onSubmit(),
        loading: assign.isPending,
        disabled: !hasSelections || !isDirty,
      }}
      secondaryAction={{ label: "Cancel", onClick: () => onOpenChange(false) }}
    >
      <div
        data-dirty={isDirty ? "true" : "false"}
        className="space-y-4"
      >
        {teachersLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-ink-500" />
          </div>
        ) : (institutionTeachers ?? []).length === 0 ? (
          <p className="text-sm text-ink-500 text-center py-8">
            No teachers found at this institution.
          </p>
        ) : (
          <div className="space-y-5">
            {(institutionTeachers ?? []).map((teacher) => {
              const teacherGrades = selections.get(teacher.id) ?? new Set<string>();
              return (
                <div
                  key={teacher.id}
                  className="rounded-card border border-surface-stroke p-3 space-y-2"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink-900">{teacher.full_name}</p>
                    {teacher.email && (
                      <p className="text-[11px] text-ink-500">{teacher.email}</p>
                    )}
                  </div>
                  {(grades ?? []).length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                      {(grades ?? []).map((g) => (
                        <label
                          key={g.id}
                          className="flex items-center gap-2 text-sm cursor-pointer"
                        >
                          <Checkbox
                            checked={teacherGrades.has(g.id)}
                            onCheckedChange={(v) =>
                              toggleGrade(teacher.id, g.id, !!v)
                            }
                          />
                          <span>{g.grade_name}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-ink-500">
          Only teachers who already have the Teacher role at this institution are listed.
          Uncheck all classes to remove a teacher from Olympiad.
        </p>
      </div>
    </MobileSheet>
  );
}
