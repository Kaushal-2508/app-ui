import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

import type { NoticeClassStaff } from "./types";

/** Students of the chosen classes, for the picker. Server-scoped to classes the
 *  caller may actually address. */
export function useNoticeClassStudents(classIds: string[]) {
  const key = [...classIds].sort().join(",");
  return useQuery({
    queryKey: ["notices", "class-students", key],
    queryFn: async (): Promise<NoticeClassStaff[]> => {
      if (classIds.length === 0) return [];
      const { data, error } = await supabase.rpc("notice_class_students", {
        _class_ids: classIds,
      });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        kind: "student",
        user_id: r.user_id,
        full_name: r.full_name,
        detail: r.detail,
      }));
    },
    enabled: classIds.length > 0,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}
