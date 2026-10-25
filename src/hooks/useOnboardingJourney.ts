import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type OnboardingMilestoneKey =
  | "first_task_assigned"
  | "first_task_completed"
  | "first_study_material_uploaded"
  | "first_exam_published"
  | "first_result_validated";

export interface OnboardingMilestone {
  key: OnboardingMilestoneKey;
  label: string;
  description: string;
  done: boolean;
}

export interface OnboardingProgress {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  institutionId: string | null;
  firstTaskAssigned: boolean;
  firstTaskCompleted: boolean;
  firstStudyMaterialUploaded: boolean;
  firstExamPublished: boolean;
  firstResultValidated: boolean;
  completedCount: number;
  completionPercent: number;
  isJourneyCompleted: boolean;
  milestones: OnboardingMilestone[];
}

export const ONBOARDING_MILESTONE_META: Record<
  OnboardingMilestoneKey,
  { label: string; description: string }
> = {
  first_task_assigned: {
    label: "First task created or received",
    description: "You've assigned a task to someone, or had one assigned to you.",
  },
  first_task_completed: {
    label: "First task completed",
    description: "You have completed your first assigned task.",
  },
  first_study_material_uploaded: {
    label: "First study material uploaded",
    description: "You have uploaded your first study material.",
  },
  first_exam_published: {
    label: "First exam published",
    description: "You have published your first exam (online or offline).",
  },
  first_result_validated: {
    label: "First result validated or published",
    description: "You have validated or published a student's result.",
  },
};

function buildMilestones(row: {
  first_task_assigned: boolean;
  first_task_completed: boolean;
  first_study_material_uploaded: boolean;
  first_exam_published: boolean;
  first_result_validated: boolean;
}): OnboardingMilestone[] {
  return (Object.keys(ONBOARDING_MILESTONE_META) as OnboardingMilestoneKey[]).map((key) => ({
    key,
    label: ONBOARDING_MILESTONE_META[key].label,
    description: ONBOARDING_MILESTONE_META[key].description,
    done: Boolean(row[key]),
  }));
}

export function useMyOnboardingProgress(enabled: boolean = true) {
  return useQuery({
    queryKey: ["onboarding-progress", "me"],
    enabled,
    queryFn: async (): Promise<OnboardingProgress | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      const { data, error } = await supabase.rpc("get_user_onboarding_progress", {
        _user_id: user.id,
      });
      if (error) throw error;
      const row = (data as any[] | null)?.[0];
      if (!row) return null;

      return {
        userId: row.user_id,
        fullName: row.full_name,
        email: row.email,
        role: row.role,
        institutionId: row.institution_id ?? null,
        firstTaskAssigned: !!row.first_task_assigned,
        firstTaskCompleted: !!row.first_task_completed,
        firstStudyMaterialUploaded: !!row.first_study_material_uploaded,
        firstExamPublished: !!row.first_exam_published,
        firstResultValidated: !!row.first_result_validated,
        completedCount: row.completed_count ?? 0,
        completionPercent: Number(row.completion_percent ?? 0),
        isJourneyCompleted: !!row.is_journey_completed,
        milestones: buildMilestones(row),
      };
    },
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
}

export interface InstitutionOnboardingRow {
  userId: string;
  fullName: string;
  email: string;
  role: string;
  firstTaskAssigned: boolean;
  firstTaskCompleted: boolean;
  firstStudyMaterialUploaded: boolean;
  firstExamPublished: boolean;
  firstResultValidated: boolean;
  completedCount: number;
  completionPercent: number;
  isJourneyCompleted: boolean;
}

export function useInstitutionOnboardingProgress(
  institutionId: string | null | undefined,
  enabled: boolean = true,
) {
  return useQuery({
    queryKey: ["onboarding-progress", "institution", institutionId],
    enabled: enabled && !!institutionId,
    queryFn: async (): Promise<InstitutionOnboardingRow[]> => {
      if (!institutionId) return [];
      const { data, error } = await supabase.rpc("get_institution_onboarding_progress", {
        _institution_id: institutionId,
      });
      if (error) throw error;
      return (data as any[] ?? []).map((row) => ({
        userId: row.user_id,
        fullName: row.full_name,
        email: row.email,
        role: row.role,
        firstTaskAssigned: !!row.first_task_assigned,
        firstTaskCompleted: !!row.first_task_completed,
        firstStudyMaterialUploaded: !!row.first_study_material_uploaded,
        firstExamPublished: !!row.first_exam_published,
        firstResultValidated: !!row.first_result_validated,
        completedCount: row.completed_count ?? 0,
        completionPercent: Number(row.completion_percent ?? 0),
        isJourneyCompleted: !!row.is_journey_completed,
      }));
    },
    staleTime: 60 * 1000,
  });
}
