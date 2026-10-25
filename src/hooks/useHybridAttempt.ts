import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import { getAppUrl } from "@/lib/appUrl";
import type { Json } from "@/integrations/supabase/types";

/**
 * Hybrid exam attempt hooks (Phase 2).
 *
 * Net-new data plane — never touches student_exam_attempts or any other
 * existing online/offline tables. All reads/writes go to hybrid_* tables.
 */

// ── Types ────────────────────────────────────────────────────────────────

export type HybridAttemptStatus =
  | "in_progress"
  | "awaiting_upload"
  | "upload_in_progress"
  | "pending_evaluation"
  | "evaluated"
  | "cancelled_no_upload";

export interface HybridAttempt {
  id: string;
  exam_id: string;
  student_id: string;
  class_id: string;
  institution_id: string;
  status: HybridAttemptStatus;
  started_at: string;
  submitted_at: string | null;
  upload_completed_at: string | null;
  evaluated_at: string | null;
  total_marks_awarded: number | null;
  total_max_marks: number | null;
}

export interface HybridQuestion {
  id: string;
  question_text: string;
  question_type: string;
  marks: number;
  options: unknown;
  parent_question_id: string | null;
  question_order: number;
  image_url: string | null;
}

export interface HybridSection {
  id: string;
  title: string;
  description: string | null;
  instructions: string | null;
  section_order: number;
  questions: HybridQuestion[];
}

export interface HybridExamPayload {
  id: string;
  title: string;
  description: string | null;
  duration_minutes: number | null;
  scheduled_date: string | null;
  start_time: string | null;
  end_time: string | null;
  total_marks: number | null;
  pass_marks: number | null;
  instructions: string | null;
  exam_mode: string;
  institution_id: string;
  settings: HybridExamSettingsRow | null;
  sections: HybridSection[];
}

export interface HybridExamSettingsRow {
  grace_window_minutes: number;
  max_pages: number;
  require_camera: boolean;
  sheet_numbering_instruction: string;
}

export interface HybridUploadedPage {
  id: string;
  attempt_id: string;
  page_number: number;
  storage_path: string;
  rotation_degrees: number;
  uploaded_at: string;
}

// ── Start (or resume) a hybrid attempt ────────────────────────────────────

interface StartHybridArgs {
  examId: string;
  classId: string;
}

interface StartHybridResult {
  attemptId: string;
  resumed: boolean;
}

export function useStartHybridAttempt() {
  const queryClient = useQueryClient();

  return useMutation<StartHybridResult, Error, StartHybridArgs>({
    mutationFn: async ({ examId, classId }) => {
      const { data: userResult, error: userError } = await supabase.auth.getUser();
      if (userError || !userResult.user) {
        throw new Error("You must be signed in to start an exam.");
      }
      const userId = userResult.user.id;

      // Resolve the exam's institution.
      const { data: examRow, error: examError } = await supabase
        .from("exams")
        .select("id, institution_id, exam_mode, status")
        .eq("id", examId)
        .single();
      if (examError || !examRow) {
        throw new Error("This exam could not be loaded.");
      }
      if (examRow.exam_mode !== "hybrid") {
        throw new Error("This is not a hybrid exam.");
      }
      if (examRow.status !== "published") {
        throw new Error("This exam is not published yet.");
      }

      // Resume an existing in-progress / awaiting-upload attempt if one exists.
      const { data: existing, error: existingError } = await supabase
        .from("hybrid_exam_attempts")
        .select("id, status")
        .eq("exam_id", examId)
        .eq("student_id", userId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        if (
          existing.status === "evaluated" ||
          existing.status === "cancelled_no_upload"
        ) {
          throw new Error("This attempt is already closed.");
        }
        return { attemptId: existing.id, resumed: true };
      }

      const { data: inserted, error: insertError } = await supabase
        .from("hybrid_exam_attempts")
        .insert({
          exam_id: examId,
          student_id: userId,
          class_id: classId,
          institution_id: examRow.institution_id,
          status: "in_progress",
        })
        .select("id")
        .single();
      if (insertError || !inserted) {
        throw insertError ?? new Error("Could not start the attempt.");
      }

      await logHybridEvent({
        attemptId: inserted.id,
        institutionId: examRow.institution_id,
        eventType: "attempt_started",
        actorId: userId,
      });

      return { attemptId: inserted.id, resumed: false };
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't start the hybrid exam.",
        context: "startHybridAttempt",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hybrid-attempt"] });
    },
  });
}

// ── Fetch attempt + exam + settings ──────────────────────────────────────

export function useHybridAttempt(attemptId: string | undefined) {
  return useQuery({
    queryKey: ["hybrid-attempt", attemptId],
    enabled: !!attemptId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HybridAttempt> => {
      const { data, error } = await supabase
        .from("hybrid_exam_attempts")
        .select(
          "id, exam_id, student_id, class_id, institution_id, status, started_at, submitted_at, upload_completed_at, evaluated_at, total_marks_awarded, total_max_marks",
        )
        .eq("id", attemptId!)
        .single();
      if (error || !data) throw error ?? new Error("Attempt not found.");
      return data as unknown as HybridAttempt;
    },
  });
}

// Student-safe hybrid exam load. Exam-level fields + settings come straight
// from `exams` (not exam_questions); the questions come from the sanitized
// SECURITY DEFINER get_exam_paper RPC, which strips every option down to
// {id,text}. Two reasons this is required for students:
//   1. the answer key (options[].isCorrect) must never reach a student's
//      browser — same leak the online attempt flow already closed;
//   2. the tightened exam_questions RLS (migration 20260707131000) blocks a
//      direct student read, so a hybrid attempt/result would otherwise return
//      empty question lists.
// The hybrid attempt + result UIs only use question text / type / marks /
// structure (see useFlatHybridQuestions) — never options — so sanitized data
// is fully sufficient. Teachers keep the direct read below (staff retain
// access via is_staff_for_exam_class, which is broader than the RPC's auth).
async function fetchSanitizedHybridExam(examId: string): Promise<HybridExamPayload> {
  const [examRes, paperRes] = await Promise.all([
    supabase
      .from("exams")
      .select(
        `
          id, title, description, duration_minutes, scheduled_date,
          start_time, end_time, total_marks, pass_marks, instructions,
          exam_mode, institution_id,
          hybrid_exam_settings (
            grace_window_minutes, max_pages, require_camera,
            sheet_numbering_instruction
          )
        `,
      )
      .eq("id", examId)
      .single(),
    supabase.rpc("get_exam_paper", { _exam_id: examId }),
  ]);
  if (examRes.error || !examRes.data) throw examRes.error ?? new Error("Exam not found.");
  if (paperRes.error) throw paperRes.error;

  const row = examRes.data as unknown as {
    id: string;
    title: string;
    description: string | null;
    duration_minutes: number | null;
    scheduled_date: string | null;
    start_time: string | null;
    end_time: string | null;
    total_marks: number | null;
    pass_marks: number | null;
    instructions: string | null;
    exam_mode: string;
    institution_id: string;
    hybrid_exam_settings: HybridExamSettingsRow | HybridExamSettingsRow[] | null;
  };

  const settingsRaw = row.hybrid_exam_settings;
  const settings: HybridExamSettingsRow | null = Array.isArray(settingsRaw)
    ? (settingsRaw[0] ?? null)
    : (settingsRaw ?? null);

  type PaperQuestion = {
    id: string;
    question_text: string;
    question_type: string;
    marks: number;
    options: unknown;
    parent_question_id: string | null;
    question_order: number;
    image_url: string | null;
  };
  type PaperSection = {
    id: string;
    title: string;
    description: string | null;
    instructions: string | null;
    section_order: number;
    exam_questions: PaperQuestion[] | null;
  };
  const paperSections = (paperRes.data ?? []) as unknown as PaperSection[];

  const sections: HybridSection[] = paperSections
    .slice()
    .sort((a, b) => a.section_order - b.section_order)
    .map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      instructions: s.instructions,
      section_order: s.section_order,
      questions: (s.exam_questions ?? [])
        .slice()
        .sort((a, b) => (a.question_order ?? 0) - (b.question_order ?? 0))
        .map((q) => ({
          id: q.id,
          question_text: q.question_text,
          question_type: q.question_type,
          marks: q.marks,
          options: q.options,
          parent_question_id: q.parent_question_id,
          question_order: q.question_order,
          image_url: q.image_url,
        })),
    }));

  return {
    id: row.id,
    title: row.title,
    description: row.description,
    duration_minutes: row.duration_minutes,
    scheduled_date: row.scheduled_date,
    start_time: row.start_time,
    end_time: row.end_time,
    total_marks: row.total_marks,
    pass_marks: row.pass_marks,
    instructions: row.instructions,
    exam_mode: row.exam_mode,
    institution_id: row.institution_id,
    settings,
    sections,
  };
}

export function useHybridExamData(
  examId: string | undefined,
  opts?: { sanitized?: boolean },
) {
  const sanitized = opts?.sanitized ?? false;
  return useQuery({
    queryKey: ["hybrid-exam-data", examId, sanitized],
    enabled: !!examId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HybridExamPayload> => {
      // Student path: sanitized questions via RPC, no direct exam_questions read.
      if (sanitized) return fetchSanitizedHybridExam(examId!);

      // Teacher/staff path: direct read (needs full data + broader staff auth).
      const { data, error } = await supabase
        .from("exams")
        .select(
          `
            id, title, description, duration_minutes, scheduled_date,
            start_time, end_time, total_marks, pass_marks, instructions,
            exam_mode, institution_id,
            hybrid_exam_settings (
              grace_window_minutes, max_pages, require_camera,
              sheet_numbering_instruction
            ),
            exam_sections (
              id, title, description, instructions, section_order,
              exam_questions (
                id, question_text, question_type, marks, options,
                parent_question_id, question_order, image_url
              )
            )
          `,
        )
        .eq("id", examId!)
        .single();
      if (error || !data) throw error ?? new Error("Exam not found.");

      const row = data as unknown as {
        id: string;
        title: string;
        description: string | null;
        duration_minutes: number | null;
        scheduled_date: string | null;
        start_time: string | null;
        end_time: string | null;
        total_marks: number | null;
        pass_marks: number | null;
        instructions: string | null;
        exam_mode: string;
        institution_id: string;
        hybrid_exam_settings: HybridExamSettingsRow | HybridExamSettingsRow[] | null;
        exam_sections: Array<{
          id: string;
          title: string;
          description: string | null;
          instructions: string | null;
          section_order: number;
          exam_questions: HybridQuestion[];
        }>;
      };

      const settingsRaw = row.hybrid_exam_settings;
      const settings: HybridExamSettingsRow | null = Array.isArray(settingsRaw)
        ? (settingsRaw[0] ?? null)
        : (settingsRaw ?? null);

      const sections: HybridSection[] = (row.exam_sections ?? [])
        .slice()
        .sort((a, b) => a.section_order - b.section_order)
        .map((s) => ({
          id: s.id,
          title: s.title,
          description: s.description,
          instructions: s.instructions,
          section_order: s.section_order,
          questions: (s.exam_questions ?? [])
            .slice()
            .sort((a, b) => (a.question_order ?? 0) - (b.question_order ?? 0)),
        }));

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        duration_minutes: row.duration_minutes,
        scheduled_date: row.scheduled_date,
        start_time: row.start_time,
        end_time: row.end_time,
        total_marks: row.total_marks,
        pass_marks: row.pass_marks,
        instructions: row.instructions,
        exam_mode: row.exam_mode,
        institution_id: row.institution_id,
        settings,
        sections,
      };
    },
  });
}

// ── Pairing token (calls edge function on mount + auto-refresh) ──────────

export interface HybridPairingToken {
  token: string;
  short_code: string;
  qr_url: string;
  expires_at: string;
}

async function callPairingTokenFn(
  attemptId: string,
  appUrl: string,
): Promise<HybridPairingToken> {
  const { data, error } = await supabase.functions.invoke(
    "generate-hybrid-pairing-token",
    { body: { attempt_id: attemptId, app_url: appUrl } },
  );
  if (error) {
    // supabase-js v2.89+ wraps the real error body on `error.context` —
    // see CLAUDE.md §21.
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const body = (await ctx.json()) as { error?: string };
        if (body?.error) throw new Error(body.error);
      } catch {
        /* fall through */
      }
    }
    throw error;
  }
  return data as HybridPairingToken;
}

export function useHybridPairingToken(
  attemptId: string | undefined,
  options: { enabled?: boolean } = {},
) {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();
  // Canonical app URL, not window.location.origin: inside the native shell the origin is capacitor://localhost.
  const appUrl = useMemo(() => getAppUrl(), []);

  const query = useQuery({
    queryKey: ["hybrid-pairing-token", attemptId],
    enabled: !!attemptId && enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: () => callPairingTokenFn(attemptId!, appUrl),
  });

  // Refresh 60s before expiry.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!query.data || !attemptId || !enabled) return;
    const expiresAt = new Date(query.data.expires_at).getTime();
    const refreshAt = expiresAt - 60 * 1000;
    const now = Date.now();
    const delay = Math.max(refreshAt - now, 1000);
    refreshTimer.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ["hybrid-pairing-token", attemptId] });
    }, delay);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [query.data, attemptId, enabled, queryClient]);

  const regenerate = () => {
    if (!attemptId) return;
    queryClient.invalidateQueries({ queryKey: ["hybrid-pairing-token", attemptId] });
  };

  return { ...query, regenerate };
}

// ── Uploaded pages (polled) ───────────────────────────────────────────────

export function useHybridUploadedPages(
  attemptId: string | undefined,
  options: { enabled?: boolean; pollMs?: number } = {},
) {
  const enabled = options.enabled ?? true;
  const pollMs = options.pollMs ?? 5000;

  return useQuery({
    queryKey: ["hybrid-uploaded-pages", attemptId],
    enabled: !!attemptId && enabled,
    refetchInterval: enabled ? pollMs : false,
    queryFn: async (): Promise<HybridUploadedPage[]> => {
      const { data, error } = await supabase
        .from("hybrid_answer_sheet_pages")
        .select("id, attempt_id, page_number, storage_path, rotation_degrees, uploaded_at")
        .eq("attempt_id", attemptId!)
        .order("page_number", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HybridUploadedPage[];
    },
  });
}

// ── State transitions ─────────────────────────────────────────────────────

export function useSubmitHybridForUpload(attemptId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!attemptId) throw new Error("No attempt");
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("hybrid_exam_attempts")
        .update({ status: "awaiting_upload", submitted_at: nowIso })
        .eq("id", attemptId);
      if (error) throw error;

      const { data: attempt } = await supabase
        .from("hybrid_exam_attempts")
        .select("institution_id, student_id")
        .eq("id", attemptId)
        .single();
      if (attempt) {
        await logHybridEvent({
          attemptId,
          institutionId: attempt.institution_id,
          eventType: "attempt_submitted_for_upload",
          actorId: attempt.student_id,
        });
      }
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't submit. Please try again.",
        context: "submitHybridForUpload",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hybrid-attempt", attemptId] });
    },
  });
}

export function useFinalizeHybridUpload(attemptId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!attemptId) throw new Error("No attempt");

      const { count, error: countError } = await supabase
        .from("hybrid_answer_sheet_pages")
        .select("id", { count: "exact", head: true })
        .eq("attempt_id", attemptId);
      if (countError) throw countError;
      if (!count || count < 1) {
        throw new Error("Upload at least one page before finishing.");
      }

      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("hybrid_exam_attempts")
        .update({ status: "pending_evaluation", upload_completed_at: nowIso })
        .eq("id", attemptId);
      if (error) throw error;

      const { data: attempt } = await supabase
        .from("hybrid_exam_attempts")
        .select("institution_id, student_id")
        .eq("id", attemptId)
        .single();
      if (attempt) {
        await logHybridEvent({
          attemptId,
          institutionId: attempt.institution_id,
          eventType: "attempt_upload_finalized",
          actorId: attempt.student_id,
          payload: { page_count: count },
        });
      }
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't finalize the upload.",
        context: "finalizeHybridUpload",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hybrid-attempt", attemptId] });
    },
  });
}

// ── Audit log helper (fire-and-forget) ────────────────────────────────────

interface LogHybridEventArgs {
  attemptId: string;
  institutionId: string;
  eventType: string;
  actorId?: string | null;
  payload?: Record<string, unknown>;
}

export async function logHybridEvent({
  attemptId,
  institutionId,
  eventType,
  actorId,
  payload,
}: LogHybridEventArgs) {
  await supabase.from("hybrid_exam_attempt_logs").insert({
    attempt_id: attemptId,
    institution_id: institutionId,
    event_type: eventType,
    actor_id: actorId ?? null,
    event_payload: (payload ?? null) as Json | null,
  });
}
