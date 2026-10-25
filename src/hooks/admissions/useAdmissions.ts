import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { toastError } from "@/lib/toast";
import { invokeAdminOperation } from "@/lib/invokeEdgeFunction";
import { supabase } from "@/integrations/supabase/client";
import { ADMISSION_DOCS_BUCKET, admissionDocumentPath, documentFileError } from "@/lib/admissions";
import { useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import type { AdmissionStage, ChecklistItem, EnquirySource, FormQuestion, Gender, PaymentMode } from "@/lib/admissions";
import { admissionKeys, callAdmissionRpc, isMissingSchemaError, probeFrom, type PgError } from "./admissionsClient";

/**
 * Hooks for the admissions pipeline. Every RPC and the edge action are
 * NEEDS DB / NEEDS EDGE FN (Tushar); the contract with each signature is in
 * docs/superpowers/specs/2026-10-09-admissions-module-design.md, section 5.
 * Nothing here runs until useAdmissionsReady() says so, so a missing
 * function never surfaces as a toast.
 */

const PAGE_SIZE = 50;

/** `admission_settings` exists: the migration has landed. A permission
 *  error still means "present" (the RPCs are what the frontend calls). */
export function useAdmissionsReady(enabled = true) {
  const query = useQuery({
    queryKey: admissionKeys.ready,
    queryFn: async (): Promise<boolean> => {
      const probe = await probeFrom("admission_settings").select("institution_id").limit(0);
      return !(probe.error && isMissingSchemaError(probe.error as PgError));
    },
    enabled,
    // A schema change is a deploy, not a minute-by-minute event.
    staleTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  return { ready: query.data === true, isLoading: query.isLoading };
}

/**
 * Who may work the pipeline: school admins always, plus staff named in
 * `admissions_overrides` (`is_admissions_staff`). Decided 2026-10-09
 * ("admins plus named staff").
 */
export function useIsAdmissionsStaff(enabled = true) {
  const { user } = useAuth();
  const { data: roleInfo, isLoading: roleLoading } = useUserRole();
  const isAdmin = !!roleInfo?.isSchoolAdmin || !!roleInfo?.isSuperAdmin;
  const query = useQuery({
    queryKey: admissionKeys.access(user?.id ?? null),
    queryFn: async (): Promise<boolean> => {
      const yes = await callAdmissionRpc<boolean | null>("is_admissions_staff", { _uid: user?.id });
      return yes === true;
    },
    enabled: enabled && !!user?.id && !!roleInfo && !isAdmin,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  return {
    allowed: isAdmin || query.data === true,
    isAdmin,
    isLoading: roleLoading || (!isAdmin && query.isLoading),
    isError: query.isError,
  };
}

export interface AdmissionSettings {
  institution_id: string;
  registration_fee_rupees: number;
  document_checklist: ChecklistItem[];
  admission_number_prefix: string | null;
  next_admission_seq: number;
  enquiry_form_enabled: boolean;
  /** The school's own questions (2026-10-12); absent on an older server. */
  form_schema?: FormQuestion[] | null;
}

export function useAdmissionSettings(institutionId: string | null, enabled = true) {
  return useQuery({
    queryKey: admissionKeys.settings(institutionId),
    queryFn: async (): Promise<AdmissionSettings> =>
      callAdmissionRpc<AdmissionSettings>("admission_get_settings", { _institution_id: institutionId }),
    enabled: enabled && !!institutionId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useSetAdmissionSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { institutionId: string; patch: Partial<Omit<AdmissionSettings, "institution_id">> }) =>
      callAdmissionRpc<AdmissionSettings>("admission_set_settings", { _institution_id: input.institutionId, _patch: input.patch }),
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: admissionKeys.settings(input.institutionId) });
      toast.success("Admissions settings saved.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the settings.", context: "setAdmissionSettings" }),
  });
}

/** One row of admission_list_staff(_institution_id): a staff account named
 *  in `admissions_overrides`. */
export interface AdmissionStaffRow {
  user_id: string;
  full_name: string;
  role: string;
}

export function useAdmissionStaff(institutionId: string | null, enabled = true) {
  return useQuery({
    queryKey: admissionKeys.staff(institutionId),
    queryFn: async (): Promise<AdmissionStaffRow[]> =>
      (await callAdmissionRpc<AdmissionStaffRow[] | null>("admission_list_staff", { _institution_id: institutionId })) ?? [],
    enabled: enabled && !!institutionId,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Staff accounts the admin may name as admissions staff
 *  (admission_staff_options: every non-student account of the school that is
 *  not already an admin; bounded by the server). */
export function useAdmissionStaffOptions(institutionId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["admission-staff-options", institutionId],
    queryFn: async (): Promise<AdmissionStaffRow[]> =>
      (await callAdmissionRpc<AdmissionStaffRow[] | null>("admission_staff_options", { _institution_id: institutionId })) ?? [],
    enabled: enabled && !!institutionId,
    // Picker furniture: staff lists change rarely.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Replace the named admissions staff of the school in one transaction. */
export function useSetAdmissionStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { institutionId: string; userIds: string[] }) =>
      callAdmissionRpc<null>("admission_set_staff", { _institution_id: input.institutionId, _user_ids: input.userIds }),
    onSuccess: (_d, input) => {
      queryClient.invalidateQueries({ queryKey: admissionKeys.staff(input.institutionId) });
      queryClient.invalidateQueries({ queryKey: ["admissions-access"] });
      toast.success("Admissions staff saved.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the admissions staff.", context: "setAdmissionStaff" }),
  });
}

/** One row of admission_pipeline(...). */
export interface AdmissionEnquiryRow {
  id: string;
  reference_no: string;
  stage: AdmissionStage;
  stage_changed_at: string;
  source: EnquirySource;
  student_name: string;
  date_of_birth: string | null;
  gender: Gender | null;
  class_group_id: string | null;
  applying_for_label: string;
  academic_year_label: string;
  parent_name: string;
  parent_phone: string;
  parent_email: string | null;
  previous_school: string | null;
  message: string | null;
  assigned_to: string | null;
  assigned_to_name: string | null;
  next_follow_up_on: string | null;
  dropped_reason: string | null;
  admission_number: string | null;
  admitted_on: string | null;
  student_profile_id: string | null;
  created_at: string;
  /** The fee record once registered. */
  registration: { fee_rupees: number; payment_mode: PaymentMode; receipt_no: string; paid_on: string } | null;
  documents_collected: number;
  documents_total: number;
  /** Other enquiries from the same phone (siblings, repeat calls); never merged. */
  other_enquiries: { id: string; student_name: string; stage: AdmissionStage; created_at: string }[] | null;
}

export interface AdmissionDocument {
  doc_key: string;
  label: string;
  collected: boolean;
  collected_at: string | null;
  /** The scanned copy, when one was uploaded (2026-10-12); absent on an
   *  older server. */
  file_path?: string | null;
  file_name?: string | null;
  file_size?: number | null;
  uploaded_at?: string | null;
}

export interface AdmissionNote {
  id: string;
  kind: "note" | "stage" | "follow_up";
  body: string;
  created_by_name: string | null;
  created_at: string;
}

/** The physical form's extra fields and the school's own answers. */
export interface AdmissionForm {
  blood_group?: string | null;
  father_name?: string | null;
  mother_name?: string | null;
  address?: string | null;
  /** Answers to the school's questions, by question id. */
  custom?: Record<string, string> | null;
}

/** admission_enquiry_detail(_id): the row plus its documents and notes. */
export interface AdmissionEnquiryDetail extends AdmissionEnquiryRow {
  form: AdmissionForm;
  documents: AdmissionDocument[];
  notes: AdmissionNote[];
}

export interface PipelineFilters {
  stage: AdmissionStage | null;
  classGroupId: string | null;
  academicYearLabel: string | null;
  q: string | null;
}

/** The pipeline, 50 rows a page (CLAUDE.md section 23: every list bounded). */
export function useAdmissionPipeline(institutionId: string | null, filters: PipelineFilters, enabled = true) {
  return useInfiniteQuery({
    queryKey: admissionKeys.pipeline(institutionId, {
      stage: filters.stage,
      classGroupId: filters.classGroupId,
      year: filters.academicYearLabel,
      q: filters.q,
    }),
    queryFn: async ({ pageParam }): Promise<AdmissionEnquiryRow[]> =>
      (await callAdmissionRpc<AdmissionEnquiryRow[] | null>("admission_pipeline", {
        _institution_id: institutionId,
        _stage: filters.stage,
        _class_group_id: filters.classGroupId,
        _academic_year_label: filters.academicYearLabel,
        _q: filters.q,
        _limit: PAGE_SIZE,
        _offset: pageParam,
      })) ?? [],
    initialPageParam: 0,
    getNextPageParam: (last, all) => (last.length < PAGE_SIZE ? undefined : all.length * PAGE_SIZE),
    enabled: enabled && !!institutionId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export interface StageCounts {
  enquiry: number;
  registered: number;
  admitted: number;
  dropped: number;
}

export function useAdmissionStageCounts(institutionId: string | null, academicYearLabel: string | null, enabled = true) {
  return useQuery({
    queryKey: admissionKeys.counts(institutionId, academicYearLabel),
    queryFn: async (): Promise<StageCounts> =>
      (await callAdmissionRpc<StageCounts | null>("admission_stage_counts", {
        _institution_id: institutionId,
        _academic_year_label: academicYearLabel,
      })) ?? { enquiry: 0, registered: 0, admitted: 0, dropped: 0 },
    enabled: enabled && !!institutionId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

export function useAdmissionEnquiry(id: string | null, enabled = true) {
  return useQuery({
    queryKey: admissionKeys.enquiry(id),
    queryFn: async (): Promise<AdmissionEnquiryDetail> =>
      callAdmissionRpc<AdmissionEnquiryDetail>("admission_enquiry_detail", { _id: id }),
    enabled: enabled && !!id,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

function invalidatePipeline(queryClient: ReturnType<typeof useQueryClient>, enquiryId?: string | null) {
  queryClient.invalidateQueries({ queryKey: ["admission-pipeline"] });
  queryClient.invalidateQueries({ queryKey: ["admission-stage-counts"] });
  if (enquiryId) queryClient.invalidateQueries({ queryKey: admissionKeys.enquiry(enquiryId) });
}

export interface EnquiryInput {
  studentName: string;
  dateOfBirth: string | null;
  gender: Gender | null;
  classGroupId: string | null;
  applyingForLabel: string;
  academicYearLabel: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string | null;
  previousSchool: string | null;
  message: string | null;
  source: EnquirySource;
  assignedTo: string | null;
  nextFollowUpOn: string | null;
  /** Answers to the school's questions; merged into the row's `form.custom`. */
  custom?: Record<string, string>;
}

function enquiryArgs(input: Partial<EnquiryInput>): Record<string, unknown> {
  return {
    ...(input.custom ? { form: { custom: input.custom } } : {}),
    student_name: input.studentName,
    date_of_birth: input.dateOfBirth,
    gender: input.gender,
    class_group_id: input.classGroupId,
    applying_for_label: input.applyingForLabel,
    academic_year_label: input.academicYearLabel,
    parent_name: input.parentName,
    parent_phone: input.parentPhone,
    parent_email: input.parentEmail,
    previous_school: input.previousSchool,
    message: input.message,
    source: input.source,
    assigned_to: input.assignedTo,
    next_follow_up_on: input.nextFollowUpOn,
  };
}

export function useCreateEnquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { institutionId: string } & EnquiryInput) =>
      callAdmissionRpc<{ id: string; reference_no: string }>("admission_create_enquiry", {
        _institution_id: input.institutionId,
        _fields: enquiryArgs(input),
      }),
    onSuccess: (result) => {
      invalidatePipeline(queryClient);
      toast.success(`Enquiry ${result.reference_no} saved.`);
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the enquiry.", context: "createEnquiry" }),
  });
}

export function useUpdateEnquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; fields: Partial<EnquiryInput> }) =>
      callAdmissionRpc<null>("admission_update_enquiry", { _id: input.id, _fields: enquiryArgs(input.fields) }),
    onSuccess: (_d, input) => {
      invalidatePipeline(queryClient, input.id);
      toast.success("Enquiry updated.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't update the enquiry.", context: "updateEnquiry" }),
  });
}

export function useAddAdmissionNote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; body: string }) =>
      callAdmissionRpc<null>("admission_add_note", { _id: input.id, _body: input.body.trim() }),
    onSuccess: (_d, input) => invalidatePipeline(queryClient, input.id),
    onError: (e: Error) => toastError(e, { fallback: "Couldn't add the note.", context: "addAdmissionNote" }),
  });
}

export function useRegisterEnquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; feeRupees: number; paymentMode: PaymentMode; receiptNo: string; paidOn: string; note: string | null }) =>
      callAdmissionRpc<null>("admission_register", {
        _id: input.id,
        _fee_rupees: input.feeRupees,
        _payment_mode: input.paymentMode,
        _receipt_no: input.receiptNo.trim(),
        _paid_on: input.paidOn,
        _note: input.note,
      }),
    onSuccess: (_d, input) => {
      invalidatePipeline(queryClient, input.id);
      toast.success("Registered. The fee is recorded.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't register this enquiry.", context: "registerEnquiry" }),
  });
}

export function useSetAdmissionDocuments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; ticks: { doc_key: string; collected: boolean }[] }) =>
      callAdmissionRpc<null>("admission_set_documents", { _id: input.id, _ticks: input.ticks }),
    onSuccess: (_d, input) => {
      invalidatePipeline(queryClient, input.id);
      toast.success("Certificates saved.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't save the certificates.", context: "setAdmissionDocuments" }),
  });
}

/**
 * Upload a certificate's scan and record it on the document row, which also
 * ticks it as collected (a scan in hand is the certificate in hand). The
 * object is written first with upsert, then the RPC records it; a failed
 * RPC leaves an orphan object that the next upload overwrites, never a
 * recorded file that is not there. Single-flight per row through `busyKey`
 * on the checklist.
 */
export function useUploadAdmissionDocument() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; institutionId: string; docKey: string; file: File }) => {
      const problem = documentFileError(input.file);
      if (problem) throw new Error(problem);
      const path = admissionDocumentPath(input.institutionId, input.id, input.docKey, input.file.name);
      const { error } = await supabase.storage.from(ADMISSION_DOCS_BUCKET).upload(path, input.file, { upsert: true, contentType: input.file.type || undefined });
      if (error) throw error;
      await callAdmissionRpc<null>("admission_set_document_file", {
        _id: input.id,
        _doc_key: input.docKey,
        _file_path: path,
        _file_name: input.file.name,
        _file_size: input.file.size,
      });
      return path;
    },
    onSuccess: (_p, input) => {
      invalidatePipeline(queryClient, input.id);
      toast.success("Document uploaded.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't upload the document.", context: "uploadAdmissionDocument" }),
  });
}

/** Remove a certificate's scan: the server deletes the object and clears
 *  the row in one transaction; the tick stays as it was. */
export function useRemoveAdmissionDocumentFile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; docKey: string }) =>
      callAdmissionRpc<null>("admission_remove_document_file", { _id: input.id, _doc_key: input.docKey }),
    onSuccess: (_d, input) => {
      invalidatePipeline(queryClient, input.id);
      toast.success("Document removed.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't remove the document.", context: "removeAdmissionDocumentFile" }),
  });
}

/** Open a certificate's scan in a new tab through a short-lived signed URL. */
export function useOpenAdmissionDocument() {
  return useMutation({
    mutationFn: async (path: string) => {
      const { data, error } = await supabase.storage.from(ADMISSION_DOCS_BUCKET).createSignedUrl(path, 300);
      if (error || !data?.signedUrl) throw error ?? new Error("No link");
      return data.signedUrl;
    },
    onSuccess: (url) => {
      const w = window.open(url, "_blank", "noopener");
      if (!w) toast.info("Allow pop-ups for this site to open the document.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't open the document.", context: "openAdmissionDocument" }),
  });
}

export function useDropEnquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; reason: string }) =>
      callAdmissionRpc<null>("admission_drop", { _id: input.id, _reason: input.reason.trim() }),
    onSuccess: (_d, input) => {
      invalidatePipeline(queryClient, input.id);
      toast.success("Enquiry dropped.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't drop the enquiry.", context: "dropEnquiry" }),
  });
}

export function useReopenEnquiry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) => callAdmissionRpc<null>("admission_reopen", { _id: input.id }),
    onSuccess: (_d, input) => {
      invalidatePipeline(queryClient, input.id);
      toast.success("Enquiry reopened.");
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't reopen the enquiry.", context: "reopenEnquiry" }),
  });
}

/** What the admit action returns: the slip the desk prints for the parent. */
export interface AdmitResult {
  profile_id: string;
  admission_number: string;
  /** What the student types at login: the admission number, or the email when one was given. */
  login_id: string;
  /** Shown once; the account is flagged must_reset_password. */
  password: string;
}

export interface AdmitInput {
  enquiryId: string;
  institutionId: string;
  studentName: string;
  dateOfBirth: string;
  gender: Gender;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
  classId: string;
  admissionNumber: string;
  /** True when the number is the pre-filled next one: the server then takes
   *  the next free one at commit, so two desks never clash. */
  admissionNumberIsAuto: boolean;
  admittedOn: string;
  previousSchool: string | null;
  /** The rest of the physical form (address, father, mother, blood group) and
   *  the school's own answers under `custom`. */
  form: AdmissionForm;
  documents: { doc_key: string; collected: boolean }[];
}

/**
 * Admission: the auth user, the profile, the student role, the class, the
 * personal details and the stage change in one server transaction, through
 * the `admit_student` action of admin-operations (CLAUDE.md section 9a: never
 * sequential client writes). Single-flight through `isPending` on the sheet.
 */
export function useAdmitStudent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AdmitInput): Promise<AdmitResult> =>
      invokeAdminOperation<AdmitResult>({
        action: "admit_student",
        data: {
          enquiryId: input.enquiryId,
          institutionId: input.institutionId,
          fullName: input.studentName.trim(),
          dateOfBirth: input.dateOfBirth,
          gender: input.gender,
          guardianName: input.guardianName.trim(),
          guardianPhone: input.guardianPhone,
          guardianEmail: input.guardianEmail,
          classId: input.classId,
          admissionNumber: input.admissionNumber.trim(),
          admissionNumberIsAuto: input.admissionNumberIsAuto,
          admittedOn: input.admittedOn,
          previousSchool: input.previousSchool,
          form: input.form,
          documents: input.documents,
        },
      }),
    onSuccess: (_r, input) => {
      invalidatePipeline(queryClient, input.enquiryId);
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["school-students"] });
      queryClient.invalidateQueries({ queryKey: ["school-admin-stats"] });
      queryClient.invalidateQueries({ queryKey: admissionKeys.settings(input.institutionId) });
    },
    onError: (e: Error) => toastError(e, { fallback: "Couldn't complete the admission.", context: "admitStudent" }),
  });
}
