import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SourcePaperFile } from "@/types/exam";

/**
 * Everything the student's exam-detail page needs for ONE published result.
 *
 * The page shows the same shell for every kind of exam and only varies the
 * expandable section at the bottom, so this hook also decides which variant a
 * result is:
 *
 *   online           — sat in the app; `student_answers` exist, so we can show
 *                      each question with the options, the correct one and what
 *                      the student picked.
 *   offline_created  — authored in SALCI but written on paper; the questions
 *                      exist but there are no per-question student answers.
 *   offline_collected— `is_results_only`: only marks were uploaded. The paper is
 *                      whatever the school attached (`source_paper_files`), and
 *                      there may be nothing to expand at all.
 *
 * (Hybrid results live on their own data plane and are handled by the page
 * directly, not through this hook.)
 */

export type ExamResultVariant = "online" | "offline_created" | "offline_collected";

export interface ResultQuestionOption {
  id: string;
  text: string;
  isCorrect: boolean;
  /** This option's own diagram, if the author attached one. */
  imageUrl: string | null;
}

export interface ResultQuestion {
  id: string;
  question_text: string;
  question_type: string;
  marks: number;
  options: ResultQuestionOption[];
  /** Diagram attached to the question, if any. */
  image_url: string | null;
  /** Raw correct answer as stored (option id, letter or free text). */
  correct_answer: string | null;
  /** What the student picked — an option id for MCQs, else free text. Null when the exam was offline. */
  student_answer: string | null;
  /** Marks the student was given, when the exam was marked per question. */
  obtained_marks: number | null;
  is_correct: boolean | null;
  feedback: string | null;
}

export interface StudentExamResultDetail {
  result: {
    id: string;
    attempt_id: string;
    percentage: number | null;
    total_marks_obtained: number;
    total_max_marks: number;
    grade: string | null;
    rank_in_class: number | null;
    is_pass: boolean;
    /**
     * Student did not sit the exam. Read this BEFORE presenting any score:
     * total_marks_obtained is 0 and percentage computes to 0 for an absentee,
     * so both read as a genuine zero otherwise.
     */
    is_absent: boolean;
    finalized_at: string | null;
    published_at: string | null;
  };
  /** Per-section marks, when the paper was built with sections. */
  section_scores: { section: string; marks: number }[];
  exam: {
    id: string | null;
    title: string;
    exam_type: string;
    scheduled_date: string | null;
    total_marks: number | null;
    pass_marks: number | null;
    duration_minutes: number | null;
    subjects: string[];
    source_paper_files: SourcePaperFile[];
  };
  time_spent_seconds: number | null;
  variant: ExamResultVariant;
  questions: ResultQuestion[];
}

/** `options` is stored two ways (CLAUDE.md / salci-module-notes §9): a legacy
 *  `{a,b,c,d}` map, or an array of `{id,text,isCorrect}`. Normalise both. */
function normalizeOptions(raw: unknown, correctAnswer: string | null): ResultQuestionOption[] {
  const isCorrectFor = (id: string, text: string, flagged?: boolean) => {
    if (flagged === true) return true;
    if (correctAnswer == null) return false;
    const needle = correctAnswer.trim().toLowerCase();
    return needle === id.trim().toLowerCase() || needle === text.trim().toLowerCase();
  };

  if (Array.isArray(raw)) {
    return raw.map((entry, i) => {
      const o = (entry ?? {}) as {
        id?: unknown;
        text?: unknown;
        isCorrect?: unknown;
        imageUrl?: unknown;
      };
      const id = String(o.id ?? i);
      const text = String(o.text ?? "");
      return {
        id,
        text,
        isCorrect: isCorrectFor(id, text, o.isCorrect === true),
        imageUrl: typeof o.imageUrl === "string" && o.imageUrl ? o.imageUrl : null,
      };
    });
  }

  if (raw && typeof raw === "object") {
    // Legacy `{a,b,c,d}` map: values are bare strings, so there is no image.
    return Object.entries(raw as Record<string, unknown>).map(([key, value]) => {
      const text = String(value ?? "");
      return { id: key, text, isCorrect: isCorrectFor(key, text), imageUrl: null };
    });
  }

  return [];
}

/** Shape of the exam row embedded on the attempt. */
interface ExamRow {
  id: string | null;
  title: string | null;
  exam_type: string | null;
  exam_mode: string | null;
  is_offline: boolean | null;
  is_results_only: boolean | null;
  scheduled_date: string | null;
  total_marks: number | null;
  pass_marks: number | null;
  duration_minutes: number | null;
  source_paper_files: SourcePaperFile[] | null;
  exam_subjects: { universal_subjects: { name: string | null } | null }[] | null;
}

interface QuestionRow {
  id: string;
  question_text: string | null;
  question_type: string | null;
  marks: number | null;
  options: unknown;
  correct_answer: string | null;
  image_url: string | null;
}

export function useStudentExamResultDetail(resultId: string | undefined) {
  return useQuery({
    queryKey: ["student-exam-result-detail", resultId],
    enabled: !!resultId,
    staleTime: 60_000,
    queryFn: async (): Promise<StudentExamResultDetail | null> => {
      if (!resultId) return null;

      const { data, error } = await supabase
        .from("final_results")
        .select(
          `id, attempt_id, percentage, total_marks_obtained, total_max_marks, grade,
           rank_in_class, is_pass, is_absent, finalized_at, published_at, section_scores,
           student_exam_attempts (
             id, exam_id, time_spent_seconds,
             exams (
               id, title, exam_type, exam_mode, is_offline, is_results_only,
               scheduled_date, total_marks, pass_marks, duration_minutes,
               source_paper_files,
               exam_subjects ( universal_subjects ( name ) )
             )
           )`,
        )
        .eq("id", resultId)
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      // `source_paper_files` comes back as the generated `Json` type, so the row
      // needs an `unknown` hop before it can be read as our narrow shape (§5a:
      // an inline structural type, never `any`).
      const attempt = (data.student_exam_attempts ?? null) as unknown as {
        id: string;
        exam_id: string | null;
        time_spent_seconds: number | null;
        exams: ExamRow | null;
      } | null;
      const exam = attempt?.exams ?? null;

      const variant: ExamResultVariant = exam?.is_results_only
        ? "offline_collected"
        : exam?.is_offline || exam?.exam_mode === "offline"
          ? "offline_created"
          : "online";

      // Questions. Online exams read through student_answers so we get what the
      // student picked; offline-created exams read the paper itself (there are no
      // per-question answers to join). Results-only exams have no question list.
      let questions: ResultQuestion[] = [];

      if (variant === "online" && attempt?.id) {
        const { data: answers, error: answersError } = await supabase
          .from("student_answers")
          .select(
            `id, question_id, answer_text, answer_options,
             exam_questions ( id, question_text, question_type, marks, options, correct_answer, image_url ),
             teacher_overrides ( final_marks, teacher_feedback )`,
          )
          .eq("attempt_id", attempt.id);
        if (answersError) throw answersError;

        type AnswerRow = {
          id: string;
          question_id: string;
          answer_text: string | null;
          answer_options: { selected?: string } | null;
          exam_questions: QuestionRow | null;
          teacher_overrides: { final_marks: number | null; teacher_feedback: string | null }[] | null;
        };

        questions = ((answers ?? []) as unknown as AnswerRow[]).map((a) => {
          const q = a.exam_questions;
          const override = a.teacher_overrides?.[0];
          const marks = Number(q?.marks ?? 0);
          const obtained = override?.final_marks == null ? null : Number(override.final_marks);
          const options = normalizeOptions(q?.options, q?.correct_answer ?? null);
          const studentAnswer = a.answer_options?.selected ?? a.answer_text ?? null;

          // Prefer the marked score; fall back to matching the chosen option.
          const isCorrect =
            obtained != null && marks > 0
              ? obtained >= marks
              : studentAnswer == null
                ? null
                : options.some((o) => o.isCorrect && o.id === studentAnswer);

          return {
            id: q?.id ?? a.question_id,
            question_text: q?.question_text ?? "Question",
            question_type: q?.question_type ?? "unknown",
            marks,
            options,
            image_url: q?.image_url ?? null,
            correct_answer: q?.correct_answer ?? null,
            student_answer: studentAnswer,
            obtained_marks: obtained,
            is_correct: isCorrect,
            feedback: override?.teacher_feedback ?? null,
          };
        });
      }

      if (variant === "offline_created" && attempt?.exam_id) {
        // exam_questions has NO exam_id — it hangs off exam_sections, so the
        // paper is reached section-first. (Verified against the live schema; the
        // columns are id, section_id, question_text, question_type, marks,
        // options, correct_answer, question_order, tags, parent_question_id…)
        const { data: sections, error: sectionsError } = await supabase
          .from("exam_sections")
          .select("id")
          .eq("exam_id", attempt.exam_id);
        if (sectionsError) throw sectionsError;
        const sectionIds = (sections ?? []).map((s) => s.id);

        if (sectionIds.length > 0) {
          // exam_questions self-references (case-study parent/child), so the
          // generated types recurse deep enough to trip TS2589 on a filter chain.
          // Narrowing the builder to just the calls used keeps inference shallow —
          // an inline structural type, never `any` (§5a).
          type PaperResponse = { data: QuestionRow[] | null; error: { message: string } | null };
          type PaperQuery = {
            select: (columns: string) => {
              in: (
                column: string,
                values: string[],
              ) => {
                order: (
                  column: string,
                  options: { ascending: boolean },
                ) => { limit: (count: number) => PromiseLike<PaperResponse> };
              };
            };
          };

          const { data: paper, error: paperError } = await (
            supabase.from("exam_questions") as unknown as PaperQuery
          )
            .select("id, question_text, question_type, marks, options, correct_answer, image_url")
            .in("section_id", sectionIds)
            .order("question_order", { ascending: true })
            .limit(200);
          if (paperError) throw paperError;

          questions = (paper ?? []).map((q) => ({
            id: q.id,
            question_text: q.question_text ?? "Question",
            question_type: q.question_type ?? "unknown",
            marks: Number(q.marks ?? 0),
            options: normalizeOptions(q.options, q.correct_answer ?? null),
            image_url: q.image_url ?? null,
            correct_answer: q.correct_answer ?? null,
            student_answer: null,
            obtained_marks: null,
            is_correct: null,
            feedback: null,
          }));
        }
      }

      // section_scores is stored two ways across the codebase's history: an object
      // map { "Section A": 12 } and an array of { section_name, marks_obtained }.
      // Normalise both so the page renders either.
      const rawSections = data.section_scores as unknown;
      const sectionScores: { section: string; marks: number }[] = Array.isArray(rawSections)
        ? (rawSections as { section_name?: string; marks_obtained?: number }[])
            .filter((s) => s && s.section_name != null)
            .map((s) => ({ section: String(s.section_name), marks: Number(s.marks_obtained ?? 0) }))
        : rawSections && typeof rawSections === "object"
          ? Object.entries(rawSections as Record<string, unknown>).map(([section, marks]) => ({
              section,
              marks: Number(marks ?? 0),
            }))
          : [];

      return {
        section_scores: sectionScores,
        result: {
          id: data.id,
          attempt_id: data.attempt_id,
          percentage: data.percentage,
          total_marks_obtained: data.total_marks_obtained,
          total_max_marks: data.total_max_marks,
          grade: data.grade,
          rank_in_class: data.rank_in_class,
          is_pass: !!data.is_pass,
          is_absent: !!data.is_absent,
          finalized_at: data.finalized_at,
          published_at: data.published_at,
        },
        exam: {
          id: exam?.id ?? attempt?.exam_id ?? null,
          title: exam?.title ?? "Exam",
          exam_type: exam?.exam_type ?? "unspecified",
          scheduled_date: exam?.scheduled_date ?? null,
          total_marks: exam?.total_marks ?? null,
          pass_marks: exam?.pass_marks ?? null,
          duration_minutes: exam?.duration_minutes ?? null,
          subjects: (exam?.exam_subjects ?? [])
            .map((es) => es.universal_subjects?.name)
            .filter((n): n is string => !!n),
          source_paper_files: (exam?.source_paper_files ?? []) as SourcePaperFile[],
        },
        time_spent_seconds: attempt?.time_spent_seconds ?? null,
        variant,
        questions,
      };
    },
  });
}
