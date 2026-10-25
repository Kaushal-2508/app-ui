import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";

export interface StudentUpdateRecord {
  email: string;
  admissionNumber?: string;
  phone?: string;
  rollNumber?: string;
}

interface BulkUpdateResult {
  success: boolean;
  results: {
    updated: number;
    notFound: string[];
    outOfScope: string[];
    errors: Array<{ email: string; message: string }>;
  };
}

export function useBulkUpdateProfiles() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      institutionId: string;
      students: StudentUpdateRecord[];
    }): Promise<BulkUpdateResult> => {
      return invokeAdminOperation<BulkUpdateResult>({
        action: "bulk_update_student_profiles",
        data: {
          institutionId: data.institutionId,
          students: data.students,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      queryClient.invalidateQueries({ queryKey: ["profiles"] });
      queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (error: Error) =>
      toastError(error, { fallback: "Bulk update failed.", context: "bulkUpdateStudentProfiles" }),
  });
}
