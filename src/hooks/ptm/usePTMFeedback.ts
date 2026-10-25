import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { formatClassName } from "@/lib/utils";
import {
  PTM_AUDIO_BUCKET,
  audioBaseType,
  audioExtensionFor,
  type PTMHat,
  type PTMMode,
  type PTMScopeType,
  type PTMWindowState,
} from "@/lib/ptm";
import { callPtmRpc, ptmKeys } from "./ptmClient";

/** The caller's own feedback row, embedded in the feedback context. */
export interface PTMMyFeedback {
  id: string;
  rating: number;
  text_message: string | null;
  audio_path: string | null;
  audio_duration_seconds: number | null;
  audio_format: string | null;
  submitted_at: string;
  updated_at: string;
}

/**
 * One row of ptm_resolve_feedback_token(_token) and ptm_open_for_feedback():
 * everything the feedback form needs in one call. `window_state`, `opens_at`
 * and `closes_at` are decided by the server in the institution's timezone.
 */
export interface PTMFeedbackContext {
  ptm_id: string;
  title: string;
  description: string | null;
  venue: string | null;
  scheduled_date: string;
  start_time: string;
  end_time: string;
  status: string;
  scope_type: PTMScopeType;
  feedback_token: string;
  feedback_edit_days: number;
  my_class_id: string | null;
  my_class_name: string | null;
  my_class_section: string | null;
  /** Class teachers of the caller's class, joined by ", "; NULL when none. */
  class_teachers: string | null;
  window_state: PTMWindowState;
  opens_at: string;
  closes_at: string;
  my_feedback: PTMMyFeedback | null;
  /** Online PTMs only, once the online migration is live: the mode and the
   *  teacher the family met. Older rows leave both undefined. */
  mode?: PTMMode | null;
  my_teacher_name?: string | null;
}

export function usePTMFeedbackByToken(token: string | null) {
  return useQuery({
    queryKey: ptmKeys.feedbackToken(token),
    queryFn: async (): Promise<PTMFeedbackContext | null> => {
      if (!token) return null;
      const rows = await callPtmRpc<PTMFeedbackContext[] | null>("ptm_resolve_feedback_token", {
        _token: token,
      });
      return rows?.[0] ?? null;
    },
    enabled: !!token,
    staleTime: 60_000,
  });
}

/** Every PTM whose feedback window is open for the calling student. */
export function usePTMOpenForFeedback(enabled = true) {
  return useQuery({
    queryKey: ptmKeys.openForFeedback,
    queryFn: async (): Promise<PTMFeedbackContext[]> => {
      const rows = await callPtmRpc<PTMFeedbackContext[] | null>("ptm_open_for_feedback");
      return rows ?? [];
    },
    enabled,
    staleTime: 60_000,
  });
}

export interface PTMAudioDraft {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

export interface SubmitPTMFeedbackInput {
  ptmId: string;
  /** The student's own id, from useAuth; only used to build the object name. */
  userId: string;
  rating: number;
  text: string;
  /** A new recording to upload, or null. */
  audio: PTMAudioDraft | null;
  /** When there is no new recording: the saved one to keep, sent back in
   *  full so an upsert never blanks its length or format; null drops it. */
  existingAudio: { path: string; durationSeconds: number | null; format: string | null } | null;
}

interface SubmitResult {
  feedback_id: string;
  previous_audio_path: string | null;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function removeAudioObject(path: string | null | undefined): Promise<void> {
  if (!path) return;
  // Best effort: an orphaned object is a cleanup problem, not a user-facing
  // failure, and the save itself has already succeeded or failed by now.
  const { error } = await supabase.storage.from(PTM_AUDIO_BUCKET).remove([path]);
  if (error) console.warn("ptm audio cleanup failed", path, error.message);
}

/**
 * Upload the recording (if any), then write the row through the RPC. The two
 * cannot share a transaction, so the order is upload first and the client
 * removes its own upload if the RPC then fails, and removes the replaced
 * recording once the RPC has committed the new path.
 */
export function useSubmitPTMFeedback() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SubmitPTMFeedbackInput): Promise<SubmitResult> => {
      let audioPath: string | null = input.existingAudio?.path ?? null;
      let audioDuration: number | null = input.existingAudio?.durationSeconds ?? null;
      let audioFormat: string | null = input.existingAudio?.format ?? null;

      if (input.audio) {
        const ext = audioExtensionFor(input.audio.mimeType);
        const contentType = audioBaseType(input.audio.mimeType);
        const path = `${input.ptmId}/${input.userId}/${randomId()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(PTM_AUDIO_BUCKET)
          .upload(path, input.audio.blob, { contentType, upsert: false });
        if (uploadError) throw uploadError;
        audioPath = path;
        audioDuration = Math.max(1, Math.round(input.audio.durationSeconds));
        audioFormat = contentType;
      }

      let result: SubmitResult;
      try {
        const data = await callPtmRpc<SubmitResult | null>("submit_ptm_feedback", {
          _ptm_id: input.ptmId,
          _rating: input.rating,
          _text: input.text.trim() || null,
          _audio_path: audioPath,
          _audio_duration_seconds: audioPath ? audioDuration : null,
          _audio_format: audioPath ? audioFormat : null,
        });
        result = data ?? { feedback_id: "", previous_audio_path: null };
      } catch (e) {
        if (input.audio) await removeAudioObject(audioPath);
        throw e;
      }

      if (result.previous_audio_path && result.previous_audio_path !== audioPath) {
        await removeAudioObject(result.previous_audio_path);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ptm-feedback-token"] });
      queryClient.invalidateQueries({ queryKey: ptmKeys.openForFeedback });
      queryClient.invalidateQueries({ queryKey: ["ptm-feedback-summary"] });
      queryClient.invalidateQueries({ queryKey: ["ptm-feedback-list"] });
      toast.success("Thank you. Your feedback has been saved.");
    },
    onError: (e: Error) =>
      toastError(e, { fallback: "Couldn't save your feedback.", context: "submitPTMFeedback" }),
  });
}

export interface PTMFeedbackSummary {
  students_in_scope: number;
  responses: number;
  /** Percentage, 0 to 100, one decimal. */
  response_rate: number;
  avg_rating: number | null;
  distribution: Record<"1" | "2" | "3" | "4" | "5", number>;
  per_class: {
    class_id: string;
    class_name: string;
    class_section: string | null;
    class_teachers: string | null;
    students: number;
    responses: number;
    avg_rating: number | null;
  }[];
  bookings: {
    enabled: boolean;
    total_slots: number;
    booked: number;
    attended: number;
    per_class: {
      class_id: string;
      total_slots: number;
      booked: number;
      attended: number;
    }[];
  };
}

export function usePTMFeedbackSummary(ptmId: string | null, hat: PTMHat | null, enabled = true) {
  return useQuery({
    queryKey: ptmKeys.summary(ptmId, hat),
    queryFn: async (): Promise<PTMFeedbackSummary | null> => {
      if (!ptmId || !hat) return null;
      return callPtmRpc<PTMFeedbackSummary | null>("ptm_feedback_summary", {
        _ptm_id: ptmId,
        _as_role: hat,
      });
    },
    enabled: enabled && !!ptmId && !!hat,
    staleTime: 60_000,
  });
}

export type PTMFeedbackSort = "newest" | "oldest" | "rating_desc" | "rating_asc";

export interface PTMFeedbackFilters {
  classId: string | null;
  rating: number | null;
  hasAudio: boolean | null;
  hasText: boolean | null;
  sort: PTMFeedbackSort;
}

export const DEFAULT_FEEDBACK_FILTERS: PTMFeedbackFilters = {
  classId: null,
  rating: null,
  hasAudio: null,
  hasText: null,
  sort: "newest",
};

/** One row of ptm_feedback_list(...). `total_count` is a window count so the
 *  client pages without a second call. */
export interface PTMFeedbackRow {
  feedback_id: string;
  student_id: string;
  student_name: string | null;
  guardian_name: string | null;
  class_id: string;
  class_name: string;
  class_section: string | null;
  rating: number;
  text_message: string | null;
  audio_path: string | null;
  audio_duration_seconds: number | null;
  submitted_at: string;
  updated_at: string;
  total_count: number;
}

export const FEEDBACK_PAGE_SIZE = 20;

async function fetchFeedbackPage(
  ptmId: string,
  hat: PTMHat,
  filters: PTMFeedbackFilters,
  limit: number,
  offset: number,
): Promise<PTMFeedbackRow[]> {
  const rows = await callPtmRpc<PTMFeedbackRow[] | null>("ptm_feedback_list", {
    _ptm_id: ptmId,
    _as_role: hat,
    _class_id: filters.classId,
    _rating: filters.rating,
    _has_audio: filters.hasAudio,
    _has_text: filters.hasText,
    _sort: filters.sort,
    _limit: limit,
    _offset: offset,
  });
  return rows ?? [];
}

export function usePTMFeedbackList(
  ptmId: string | null,
  hat: PTMHat | null,
  filters: PTMFeedbackFilters,
  page: number,
  enabled = true,
) {
  return useQuery({
    queryKey: ptmKeys.list(ptmId, hat, filters, page),
    queryFn: async (): Promise<{ rows: PTMFeedbackRow[]; total: number }> => {
      if (!ptmId || !hat) return { rows: [], total: 0 };
      const rows = await fetchFeedbackPage(ptmId, hat, filters, FEEDBACK_PAGE_SIZE, page * FEEDBACK_PAGE_SIZE);
      return { rows, total: rows[0]?.total_count ?? 0 };
    },
    enabled: enabled && !!ptmId && !!hat,
    staleTime: 60_000,
    placeholderData: (previous) => previous,
  });
}

/** A short-lived signed URL for one recording; the storage policy decides
 *  whether this reader may have it. */
export async function getPTMAudioUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from(PTM_AUDIO_BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

const EXPORT_HARD_CAP = 5000;
const EXPORT_PAGE = 100;
const SIGNED_URL_CHUNK = 100;
const EXPORT_LINK_SECONDS = 7 * 24 * 3600;

/**
 * Pages through the same list RPC the screen uses (bounded, CLAUDE.md 23),
 * signs the audio links in batches, and hands back CSV text. The caller
 * downloads it. Papa is imported lazily so the detail page does not carry it.
 */
export async function buildPTMFeedbackCsv(
  ptmId: string,
  hat: PTMHat,
  filters: PTMFeedbackFilters,
): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  const rows: PTMFeedbackRow[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total && rows.length < EXPORT_HARD_CAP) {
    const page = await fetchFeedbackPage(ptmId, hat, filters, EXPORT_PAGE, offset);
    if (page.length === 0) break;
    total = page[0].total_count;
    rows.push(...page);
    offset += page.length;
  }
  const truncated = rows.length >= EXPORT_HARD_CAP && offset < total;

  const links = new Map<string, string>();
  const paths = rows.map((r) => r.audio_path).filter((p): p is string => !!p);
  for (let i = 0; i < paths.length; i += SIGNED_URL_CHUNK) {
    const chunk = paths.slice(i, i + SIGNED_URL_CHUNK);
    const { data, error } = await supabase.storage
      .from(PTM_AUDIO_BUCKET)
      .createSignedUrls(chunk, EXPORT_LINK_SECONDS);
    if (error) throw error;
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) links.set(item.path, item.signedUrl);
    }
  }

  const { default: Papa } = await import("papaparse");
  const csv = Papa.unparse(
    rows.map((r) => ({
      Student: r.student_name ?? "",
      Guardian: r.guardian_name ?? "",
      Class: formatClassName(r.class_name, r.class_section),
      Rating: r.rating,
      Feedback: r.text_message ?? "",
      "Audio link (valid 7 days)": r.audio_path ? links.get(r.audio_path) ?? "" : "",
      "Audio length (seconds)": r.audio_duration_seconds ?? "",
      "Submitted at": r.submitted_at,
      "Last edited": r.updated_at,
    })),
    // Family-written text reaches a spreadsheet: a message starting with
    // = + - @ would otherwise run as a formula when an admin opens the file
    // in Excel (CSV injection). Papa prefixes such cells with a quote.
    { escapeFormulae: true },
  );
  return { csv, rowCount: rows.length, truncated };
}
