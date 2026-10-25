import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toastError } from "@/lib/toast";
import { logActivityEvent } from "@/lib/activityLog";

export interface OptionalBatch {
  id: string;
  label: string;
  status: string;
  academic_year: string;
  subject_id: string;
  subject_name: string;
  teacher_id: string | null;
  teacher_name: string | null;
  roster_count: number;
}

export interface EnrolledStudent {
  student_id: string;
  full_name: string;
  roll_number: string | null;
  class_label: string | null;
}

/** Distinct optional subjects offered anywhere in the institution. */
export function useInstitutionOptionalSubjects(institutionId: string | null) {
  return useQuery({
    queryKey: ["institution-optional-subjects", institutionId],
    queryFn: async (): Promise<{ id: string; name: string }[]> => {
      const { data, error } = await supabase
        .from("subject_class_group_mappings" as never)
        .select("subject_id, universal_subjects!inner(id, name)")
        .eq("institution_id", institutionId as string)
        .eq("is_optional", true);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Array<{
        subject_id: string;
        universal_subjects: { id: string; name: string } | null;
      }>;
      const seen = new Set<string>();
      const out: { id: string; name: string }[] = [];
      for (const r of rows) {
        if (!r.universal_subjects || seen.has(r.subject_id)) continue;
        seen.add(r.subject_id);
        out.push({ id: r.subject_id, name: r.universal_subjects.name });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });
}

export function useOptionalBatches(institutionId: string | null, academicYear: string | null) {
  return useQuery({
    queryKey: ["optional-batches", institutionId, academicYear],
    queryFn: async (): Promise<OptionalBatch[]> => {
      const { data, error } = await supabase
        .from("optional_batches")
        .select("id, label, status, academic_year, subject_id, teacher_id, optional_batch_students(count)")
        .eq("institution_id", institutionId as string)
        .eq("academic_year", academicYear as string)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const rows = (data ?? []) as unknown as Array<{
        id: string; label: string; status: string; academic_year: string;
        subject_id: string; teacher_id: string | null;
        optional_batch_students: { count: number }[];
      }>;
      if (rows.length === 0) return [];

      const subjectIds = [...new Set(rows.map((r) => r.subject_id))];
      const teacherIds = [...new Set(rows.map((r) => r.teacher_id).filter(Boolean))] as string[];

      const [{ data: subs }, { data: teachers }] = await Promise.all([
        supabase.from("universal_subjects").select("id, name").in("id", subjectIds),
        teacherIds.length
          ? supabase.from("profiles").select("id, full_name").in("id", teacherIds)
          : Promise.resolve({ data: [] as { id: string; full_name: string | null }[] }),
      ]);
      const subMap = new Map((subs ?? []).map((s) => [s.id, s.name]));
      const tMap = new Map((teachers ?? []).map((t) => [t.id, t.full_name]));

      return rows.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        academic_year: r.academic_year,
        subject_id: r.subject_id,
        subject_name: subMap.get(r.subject_id) ?? "Subject",
        teacher_id: r.teacher_id,
        teacher_name: r.teacher_id ? tMap.get(r.teacher_id) ?? null : null,
        roster_count: r.optional_batch_students?.[0]?.count ?? 0,
      }));
    },
    enabled: !!institutionId && !!academicYear,
    staleTime: 60_000,
  });
}

export function useUpsertOptionalBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id?: string;
      institution_id: string;
      academic_year: string;
      subject_id: string;
      teacher_id: string | null;
      label: string;
    }) => {
      const { data: sessionData } = await supabase.auth.getSession();
      const actorId = sessionData.session?.user?.id ?? null;
      const payload = {
        institution_id: input.institution_id,
        academic_year: input.academic_year,
        subject_id: input.subject_id,
        teacher_id: input.teacher_id,
        label: input.label,
        created_by: actorId,
      };
      if (input.id) {
        const { error } = await supabase.from("optional_batches").update(payload).eq("id", input.id);
        if (error) throw error;
        return input.id;
      }
      const { data, error } = await supabase.from("optional_batches").insert(payload).select("id").single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (_id, input) => {
      queryClient.invalidateQueries({ queryKey: ["optional-batches", input.institution_id] });
      toast.success(input.id ? "Batch updated" : "Batch created");
      void logActivityEvent({
        action: input.id ? "optional_batch_updated" : "optional_batch_created",
        entityType: "OptionalBatch",
        entityName: input.label,
        metadata: { institution_id: input.institution_id, subject_id: input.subject_id },
      });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save this batch.", context: "upsertOptionalBatch" }),
  });
}

export function useDeleteOptionalBatch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; institution_id: string }) => {
      const { error } = await supabase.from("optional_batches").delete().eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["optional-batches", input.institution_id] });
      toast.success("Batch deleted");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't delete this batch.", context: "deleteOptionalBatch" }),
  });
}

/** Students currently on a batch's roster. */
export function useOptionalBatchRoster(batchId: string | null) {
  return useQuery({
    queryKey: ["optional-batch-roster", batchId],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("optional_batch_students")
        .select("student_id")
        .eq("batch_id", batchId as string);
      if (error) throw error;
      return new Set<string>((data ?? []).map((r) => r.student_id));
    },
    enabled: !!batchId,
    staleTime: 30_000,
  });
}

/** Students enrolled in a subject (cross-section) — candidates for a batch roster. */
export function useOptionalSubjectEnrolledStudents(subjectId: string | null, institutionId: string | null) {
  return useQuery({
    queryKey: ["optional-subject-enrolled-students", subjectId, institutionId],
    queryFn: async (): Promise<EnrolledStudent[]> => {
      const { data, error } = await supabase.rpc("optional_subject_enrolled_students", {
        _subject: subjectId as string,
        _institution: institutionId as string,
      });
      if (error) throw error;
      return ((data ?? []) as EnrolledStudent[]).sort((a, b) =>
        (a.full_name ?? "").localeCompare(b.full_name ?? ""),
      );
    },
    enabled: !!subjectId && !!institutionId,
    staleTime: 30_000,
  });
}

export function useToggleBatchStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { batchId: string; studentId: string; add: boolean }) => {
      if (input.add) {
        const { error } = await supabase
          .from("optional_batch_students")
          .insert({ batch_id: input.batchId, student_id: input.studentId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("optional_batch_students")
          .delete()
          .eq("batch_id", input.batchId)
          .eq("student_id", input.studentId);
        if (error) throw error;
      }
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["optional-batch-roster", input.batchId] });
      queryClient.invalidateQueries({ queryKey: ["optional-batches"] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the roster.", context: "toggleBatchStudent" }),
  });
}

/** Batch ids scheduled into a timetable band cell. */
export function useBandScheduledBatchIds(bandSlotId: string | null) {
  return useQuery({
    queryKey: ["optional-band-slot-batches", bandSlotId],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("optional_band_slots")
        .select("batch_id")
        .eq("band_slot_id", bandSlotId as string);
      if (error) throw error;
      return new Set<string>((data ?? []).map((r) => r.batch_id));
    },
    enabled: !!bandSlotId,
    staleTime: 30_000,
  });
}

/** Schedule / unschedule a batch into a band cell (optional_band_slots). */
export function useToggleBandSchedule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { bandSlotId: string; batchId: string; add: boolean }) => {
      if (input.add) {
        const { error } = await supabase
          .from("optional_band_slots")
          .insert({ band_slot_id: input.bandSlotId, batch_id: input.batchId });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("optional_band_slots")
          .delete()
          .eq("band_slot_id", input.bandSlotId)
          .eq("batch_id", input.batchId);
        if (error) throw error;
      }
      return input;
    },
    onSuccess: (input) => {
      queryClient.invalidateQueries({ queryKey: ["optional-band-slot-batches", input.bandSlotId] });
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't update the band schedule.", context: "toggleBandSchedule" }),
  });
}
