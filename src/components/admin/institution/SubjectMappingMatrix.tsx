import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { useInstitutionClassGroups } from "@/hooks/useClassGroups";

interface SubjectMappingMatrixProps {
  institutionId: string;
}

interface SubjectInfo {
  id: string;
  name: string;
  code: string | null;
}

export function SubjectMappingMatrix({ institutionId }: SubjectMappingMatrixProps) {
  const queryClient = useQueryClient();

  const { data: groups, isLoading: groupsLoading } =
    useInstitutionClassGroups(institutionId);

  // Subjects currently referenced by EITHER the group-level or the per-section
  // mappings for this institution. That keeps the matrix coherent during
  // Phase 2 transition — admins still see every subject already in use even
  // if the Phase 1 backfill hasn't rehydrated their group table yet.
  const { data: subjects, isLoading: subjectsLoading } = useQuery({
    queryKey: ["matrix-subjects-in-use", institutionId],
    queryFn: async (): Promise<SubjectInfo[]> => {
      const [groupRes, sectionRes] = await Promise.all([
        supabase
          .from("subject_class_group_mappings" as never)
          .select("subject_id")
          .eq("institution_id", institutionId),
        supabase
          .from("subject_class_mappings")
          .select("subject_id")
          .eq("institution_id", institutionId),
      ]);

      const subjectIds = new Set<string>();
      ((groupRes.data ?? []) as unknown as Array<{ subject_id: string }>).forEach((m) =>
        subjectIds.add(m.subject_id)
      );
      (sectionRes.data ?? []).forEach((m) => subjectIds.add(m.subject_id));
      if (subjectIds.size === 0) return [];

      const { data, error } = await supabase
        .from("universal_subjects")
        .select("id, name, code")
        .in("id", [...subjectIds])
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!institutionId,
  });

  // Group-level mappings power the matrix cells.
  const { data: groupMappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ["matrix-group-mappings", institutionId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subject_class_group_mappings" as never)
        .select("id, class_group_id, subject_id")
        .eq("institution_id", institutionId);
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string;
        class_group_id: string;
        subject_id: string;
      }>;
    },
    enabled: !!institutionId,
  });

  const isMapped = useMemo(() => {
    if (!groupMappings) return () => false;
    const key = (g: string, s: string) => `${g}::${s}`;
    const set = new Set(groupMappings.map((m) => key(m.class_group_id, m.subject_id)));
    return (classGroupId: string, subjectId: string) =>
      set.has(key(classGroupId, subjectId));
  }, [groupMappings]);

  const toggleMapping = useMutation({
    mutationFn: async ({
      classGroupId,
      subjectId,
      currentlyMapped,
    }: {
      classGroupId: string;
      subjectId: string;
      currentlyMapped: boolean;
    }) => {
      if (currentlyMapped) {
        const { error } = await supabase
          .from("subject_class_group_mappings" as never)
          .delete()
          .eq("institution_id", institutionId)
          .eq("class_group_id", classGroupId)
          .eq("subject_id", subjectId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("subject_class_group_mappings" as never)
          .insert({
            institution_id: institutionId,
            class_group_id: classGroupId,
            subject_id: subjectId,
          } as never);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["matrix-group-mappings", institutionId],
      });
      queryClient.invalidateQueries({ queryKey: ["class-group-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["class-subjects"] });
      queryClient.invalidateQueries({ queryKey: ["subject-class-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["teacher-assigned-subjects"] });
    },
    onError: (e: Error) =>
      toastError(e, {
        fallback: "Couldn't update this subject mapping.",
        context: "toggleSubjectMapping",
      }),
  });

  const isLoading = groupsLoading || subjectsLoading || mappingsLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!groups?.length || !subjects?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        {!groups?.length
          ? "No classes created. Add classes first."
          : "No subjects assigned yet. Use 'Assign subject' to map a subject to a class."}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Each row is one class (e.g. Class 10). Toggling a subject applies to every
        section under that class.
      </p>

      <ScrollArea className="h-[400px] border rounded-lg">
        <div className="min-w-max">
          <table className="w-full">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="p-2 text-left font-medium text-sm border-b min-w-[160px]">
                  Class
                </th>
                {subjects.map((subject) => (
                  <th
                    key={subject.id}
                    className="p-2 text-center font-medium text-sm border-b min-w-[80px]"
                    title={subject.name}
                  >
                    <Badge variant="outline" className="text-xs">
                      {subject.code || subject.name.slice(0, 4).toUpperCase()}
                    </Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <tr key={group.id} className="hover:bg-muted/50">
                  <td className="p-2 border-b">
                    <div className="flex flex-col">
                      <span className="font-medium text-sm">{group.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {group.academic_year} · {group.section_count} section
                        {group.section_count === 1 ? "" : "s"}
                      </span>
                    </div>
                  </td>
                  {subjects.map((subject) => {
                    const mapped = isMapped(group.id, subject.id);
                    return (
                      <td
                        key={`${group.id}-${subject.id}`}
                        className="p-2 border-b text-center"
                      >
                        <Checkbox
                          checked={mapped}
                          onCheckedChange={() =>
                            toggleMapping.mutate({
                              classGroupId: group.id,
                              subjectId: subject.id,
                              currentlyMapped: mapped,
                            })
                          }
                          disabled={toggleMapping.isPending}
                          aria-label={`Toggle ${subject.name} for ${group.name}`}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </ScrollArea>

      <div className="flex gap-4 text-sm text-muted-foreground">
        <div>Classes: {groups.length}</div>
        <div>Subjects: {subjects.length}</div>
        <div>Mappings: {groupMappings?.length || 0}</div>
      </div>
    </div>
  );
}
