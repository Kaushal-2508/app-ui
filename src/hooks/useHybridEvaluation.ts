import { useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toastError } from "@/lib/toast";
import type { Json } from "@/integrations/supabase/types";
import {
  useHybridAttempt,
  useHybridExamData,
  type HybridExamPayload,
  type HybridAttempt,
} from "./useHybridAttempt";

/**
 * Teacher-side evaluation hooks (Phase 4).
 */

// ── Types ────────────────────────────────────────────────────────────────

export type AnnotationType =
  | "highlight"
  | "tick"
  | "cross"
  | "comment"
  | "freehand"
  | "marks_stamp";

export interface NormalizedRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface NormalizedPoint {
  x: number;
  y: number;
}

export interface AnnotationCoordinates {
  // For highlight: { x1, y1, x2, y2 }.
  // For tick / cross / comment: { x, y } (single point).
  // For freehand: { points: [{x,y}, ...] }.
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  x?: number;
  y?: number;
  points?: NormalizedPoint[];
}

export interface HybridAnnotation {
  id: string;
  attempt_id: string;
  question_id: string | null;
  page_id: string | null;
  page_number: number;
  annotation_type: AnnotationType;
  coordinates: AnnotationCoordinates;
  color: string;
  text_content: string | null;
  created_by: string | null;
  created_at: string;
}

export interface HybridQuestionMark {
  id: string;
  attempt_id: string;
  question_id: string;
  marks_awarded: number | null;
  max_marks: number;
  teacher_comment: string | null;
  is_flagged: boolean;
  marked_by: string | null;
  marked_at: string | null;
}

export interface HybridSignedPage {
  page_id: string;
  page_number: number;
  storage_path: string;
  rotation_degrees: number;
  signed_url: string;
}

// ── Combined evaluation data (sections, attempt, pages with signed URLs) ──

export function useHybridEvaluationData(
  attemptId: string | undefined,
  opts?: { sanitized?: boolean },
) {
  const attemptQuery = useHybridAttempt(attemptId);
  const attempt = attemptQuery.data;
  // Student result view passes { sanitized: true } so the questions come from
  // the answer-key-stripped get_exam_paper RPC (and avoid a direct
  // exam_questions read that the tightened RLS blocks for students). The
  // teacher evaluation view omits it and keeps the full direct read. The
  // hybrid grading UI only uses question text/type/marks, so sanitized data
  // is sufficient for the student.
  const examQuery = useHybridExamData(attempt?.exam_id, opts);

  const pagesQuery = useQuery({
    queryKey: ["hybrid-eval-pages", attemptId],
    enabled: !!attemptId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HybridSignedPage[]> => {
      const { data: pages, error } = await supabase
        .from("hybrid_answer_sheet_pages")
        .select("id, page_number, storage_path, rotation_degrees")
        .eq("attempt_id", attemptId!)
        .order("page_number", { ascending: true });
      if (error) throw error;
      const rows = pages ?? [];
      if (rows.length === 0) return [];
      const { data: signed, error: signedError } = await supabase.storage
        .from("hybrid-answer-sheets")
        .createSignedUrls(
          rows.map((r) => r.storage_path),
          60 * 30, // 30 minutes
        );
      if (signedError) throw signedError;
      return rows.map((r, i) => ({
        page_id: r.id,
        page_number: r.page_number,
        storage_path: r.storage_path,
        rotation_degrees: r.rotation_degrees,
        signed_url: signed?.[i]?.signedUrl ?? "",
      }));
    },
  });

  const marksQuery = useQuery({
    queryKey: ["hybrid-eval-marks", attemptId],
    enabled: !!attemptId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HybridQuestionMark[]> => {
      const { data, error } = await supabase
        .from("hybrid_question_marks")
        .select(
          "id, attempt_id, question_id, marks_awarded, max_marks, teacher_comment, is_flagged, marked_by, marked_at",
        )
        .eq("attempt_id", attemptId!);
      if (error) throw error;
      return (data ?? []) as unknown as HybridQuestionMark[];
    },
  });

  const annotationsQuery = useQuery({
    queryKey: ["hybrid-eval-annotations", attemptId],
    enabled: !!attemptId,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<HybridAnnotation[]> => {
      const { data, error } = await supabase
        .from("hybrid_sheet_annotations")
        .select(
          "id, attempt_id, question_id, page_id, page_number, annotation_type, coordinates, color, text_content, created_by, created_at",
        )
        .eq("attempt_id", attemptId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as HybridAnnotation[];
    },
  });

  return {
    attempt,
    exam: examQuery.data,
    pages: pagesQuery.data ?? [],
    marks: marksQuery.data ?? [],
    annotations: annotationsQuery.data ?? [],
    isLoading:
      attemptQuery.isLoading ||
      examQuery.isLoading ||
      pagesQuery.isLoading ||
      marksQuery.isLoading ||
      annotationsQuery.isLoading,
    isError:
      attemptQuery.isError ||
      examQuery.isError ||
      pagesQuery.isError ||
      marksQuery.isError ||
      annotationsQuery.isError,
  };
}

// ── Flat question list (resolved against the exam) ───────────────────────

export interface FlatQuestion {
  id: string;
  questionNumber: string; // "Q1", "Q3a", etc.
  questionText: string;
  questionType: string;
  marks: number;
  sectionTitle: string;
  parentId: string | null;
}

export function useFlatHybridQuestions(exam: HybridExamPayload | undefined) {
  return useMemo<FlatQuestion[]>(() => {
    if (!exam) return [];
    const out: FlatQuestion[] = [];
    exam.sections.forEach((section) => {
      const parents = section.questions.filter((q) => !q.parent_question_id);
      parents.forEach((parent, parentIdx) => {
        const parentNum = parentIdx + 1;
        const subs = section.questions.filter(
          (q) => q.parent_question_id === parent.id,
        );
        if (subs.length === 0) {
          out.push({
            id: parent.id,
            questionNumber: `Q${parentNum}`,
            questionText: parent.question_text,
            questionType: parent.question_type,
            marks: parent.marks,
            sectionTitle: section.title,
            parentId: null,
          });
        } else {
          // Parent passage row (no marks input)
          out.push({
            id: parent.id,
            questionNumber: `Q${parentNum}`,
            questionText: parent.question_text,
            questionType: parent.question_type,
            marks: 0,
            sectionTitle: section.title,
            parentId: null,
          });
          subs.forEach((sub, subIdx) => {
            out.push({
              id: sub.id,
              questionNumber: `Q${parentNum}${String.fromCharCode(97 + subIdx)}`,
              questionText: sub.question_text,
              questionType: sub.question_type,
              marks: sub.marks,
              sectionTitle: section.title,
              parentId: parent.id,
            });
          });
        }
      });
    });
    return out;
  }, [exam]);
}

// ── Mark mutations ────────────────────────────────────────────────────────

interface UpsertMarkArgs {
  attemptId: string;
  questionId: string;
  marksAwarded: number | null;
  maxMarks: number;
  institutionId: string;
  teacherComment?: string | null;
  isFlagged?: boolean;
}

export function useUpsertHybridMark(): UseMutationResult<
  void,
  Error,
  UpsertMarkArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      attemptId,
      questionId,
      marksAwarded,
      maxMarks,
      institutionId,
      teacherComment,
      isFlagged,
    }) => {
      const { data: userResult } = await supabase.auth.getUser();
      const markedBy = userResult.user?.id ?? null;
      const { error } = await supabase
        .from("hybrid_question_marks")
        .upsert(
          {
            attempt_id: attemptId,
            question_id: questionId,
            institution_id: institutionId,
            marks_awarded: marksAwarded,
            max_marks: maxMarks,
            teacher_comment: teacherComment ?? null,
            is_flagged: isFlagged ?? false,
            marked_by: markedBy,
            marked_at: new Date().toISOString(),
          },
          { onConflict: "attempt_id,question_id" },
        );
      if (error) throw error;
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't save the mark.",
        context: "upsertHybridMark",
      }),
    onSuccess: (_void, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["hybrid-eval-marks", vars.attemptId],
      });
    },
  });
}

// ── Annotation mutations ──────────────────────────────────────────────────

interface InsertAnnotationArgs {
  attemptId: string;
  questionId: string | null;
  pageId: string | null;
  pageNumber: number;
  institutionId: string;
  annotationType: AnnotationType;
  coordinates: AnnotationCoordinates;
  color: string;
  textContent?: string | null;
}

export function useInsertHybridAnnotation(): UseMutationResult<
  HybridAnnotation,
  Error,
  InsertAnnotationArgs
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args) => {
      const { data: userResult } = await supabase.auth.getUser();
      const createdBy = userResult.user?.id ?? null;
      const { data, error } = await supabase
        .from("hybrid_sheet_annotations")
        .insert({
          attempt_id: args.attemptId,
          question_id: args.questionId,
          page_id: args.pageId,
          page_number: args.pageNumber,
          institution_id: args.institutionId,
          annotation_type: args.annotationType,
          coordinates: args.coordinates as unknown as Json,
          color: args.color,
          text_content: args.textContent ?? null,
          created_by: createdBy,
        })
        .select(
          "id, attempt_id, question_id, page_id, page_number, annotation_type, coordinates, color, text_content, created_by, created_at",
        )
        .single();
      if (error) throw error;
      return data as unknown as HybridAnnotation;
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't save the annotation.",
        context: "insertHybridAnnotation",
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["hybrid-eval-annotations", vars.attemptId],
      });
    },
  });
}

export function useRotateHybridPage(): UseMutationResult<
  void,
  Error,
  { pageId: string; nextRotation: number; attemptId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ pageId, nextRotation }) => {
      const normalized = ((nextRotation % 360) + 360) % 360;
      const stepped = [0, 90, 180, 270].includes(normalized)
        ? normalized
        : Math.round(normalized / 90) * 90;
      const { error } = await supabase
        .from("hybrid_answer_sheet_pages")
        .update({ rotation_degrees: stepped })
        .eq("id", pageId);
      if (error) throw error;
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't rotate the page.",
        context: "rotateHybridPage",
      }),
    onSuccess: (_void, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["hybrid-eval-pages", vars.attemptId],
      });
    },
  });
}

export function useDeleteHybridAnnotation(): UseMutationResult<
  void,
  Error,
  { id: string; attemptId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }) => {
      const { error } = await supabase
        .from("hybrid_sheet_annotations")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't remove the annotation.",
        context: "deleteHybridAnnotation",
      }),
    onSuccess: (_void, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["hybrid-eval-annotations", vars.attemptId],
      });
    },
  });
}

export function useClearAnnotationsForQuestion(): UseMutationResult<
  number,
  Error,
  { attemptId: string; questionId: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ attemptId, questionId }) => {
      const { error, count } = await supabase
        .from("hybrid_sheet_annotations")
        .delete({ count: "exact" })
        .eq("attempt_id", attemptId)
        .eq("question_id", questionId);
      if (error) throw error;
      return count ?? 0;
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't clear annotations.",
        context: "clearAnnotationsForQuestion",
      }),
    onSuccess: (_count, vars) => {
      queryClient.invalidateQueries({
        queryKey: ["hybrid-eval-annotations", vars.attemptId],
      });
    },
  });
}

// ── Publish marks (calls the edge function) ───────────────────────────────

async function unwrapFnError(error: unknown): Promise<Error> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return new Error(body.error);
    } catch {
      /* fall through */
    }
  }
  return error instanceof Error ? error : new Error("Unknown error");
}

export interface PublishHybridMarksResult {
  attempt_id: string;
  total_marks_awarded: number;
  total_max_marks: number;
  status: HybridAttempt["status"];
}

export function usePublishHybridMarks() {
  const queryClient = useQueryClient();
  return useMutation<PublishHybridMarksResult, Error, { attemptId: string }>({
    mutationFn: async ({ attemptId }) => {
      const { data, error } = await supabase.functions.invoke(
        "publish-hybrid-marks",
        { body: { attempt_id: attemptId } },
      );
      if (error) throw await unwrapFnError(error);
      return data as PublishHybridMarksResult;
    },
    onError: (err) =>
      toastError(err, {
        fallback: "Couldn't publish marks.",
        context: "publishHybridMarks",
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({
        queryKey: ["hybrid-attempt", result.attempt_id],
      });
      queryClient.invalidateQueries({
        queryKey: ["hybrid-eval-marks", result.attempt_id],
      });
    },
  });
}
