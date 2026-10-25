import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeEdgeFunction } from "@/lib/invokeEdgeFunction";
import { toastError } from "@/lib/toast";
import { toast } from "sonner";

export type OnboardSchoolInput = {
  campaign_id: string;
  is_existing_salci_school: boolean;
  institution_id?: string;        // required when is_existing_salci_school
  school_name?: string;           // required when !is_existing_salci_school
  city?: string;
  state?: string;
  primary_contact_name: string;
  primary_contact_email: string;
  primary_contact_phone: string;
  participating_grade_level_ids: string[];
  price_override_rupees?: number | null;
  internal_notes?: string | null;
};

export type OnboardSchoolResult = {
  oly_school_id: string;
  institution_id: string;
  school_short_code: string;   // server-generated
  institute_code: string;      // server-generated (empty for existing schools)
  admin_email: string;         // empty for existing schools
  temp_password: string;       // readable temp password (empty for existing schools)
  reset_link: string;          // empty for existing schools
};

export function useOnboardSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: OnboardSchoolInput): Promise<OnboardSchoolResult> => {
      return invokeEdgeFunction<OnboardSchoolResult>("oly-onboard-school", input);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["olympiad", "schools"] });
      toast.success("School onboarded");
    },
    onError: (err: Error) =>
      toastError(err, { fallback: "Couldn't onboard school.", context: "useOnboardSchool" }),
  });
}
