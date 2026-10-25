import type { Tone } from "@/components/shared/design-system";
import {
  ATTENDANCE_WARN_THRESHOLD,
  COMPARISON_BAND,
  TREND_FLAT_BAND,
} from "@/lib/performanceLabels";

/**
 * Rule-based "what should I do next" engine for the student dashboard.
 *
 * Deterministic on purpose, like the rest of the student portal's label engine:
 * the same numbers always produce the same advice, it costs nothing, it renders
 * instantly, and a parent is never shown a claim no one can trace back to the
 * data. (See src/lib/performanceLabels.ts for the same reasoning.)
 *
 * Every suggestion must be SPECIFIC — it names the subject, the gap, or the
 * deadline. "Work harder" helps nobody.
 */

export interface StudentSuggestion {
  id: string;
  /** Lower sorts first. Actionable problems outrank praise. */
  priority: number;
  title: string;
  detail: string;
  tone: Tone;
  /** Optional one-line "where exactly" — e.g. the weakest chapter in this subject. */
  pointer?: string;
  action?: { label: string; to: string };
}

export interface SuggestionSubject {
  subject: string;
  student_avg: number | null;
  class_avg: number | null;
  n_tests: number;
}

/** Per-chapter scores, from the chapters the teacher tagged the exam with. */
export interface SuggestionChapter {
  subject: string;
  chapter: string;
  avg_pct: number | null;
  n_tests: number;
}

export interface SuggestionInput {
  subjects: SuggestionSubject[];
  /** Chapter-level scores so a subject suggestion can name the exact weak chapter. */
  chapters: SuggestionChapter[];
  /** Chronological own-score points; only the last two are used. */
  recentScores: number[];
  attendancePct: number | null;
  pendingHomework: number;
  /** Soonest upcoming exam, if any. */
  nextExam: { title: string; date: string } | null;
  /** Percentile among classmates (0-100) and how many classmates it came from. */
  percentile: number | null;
  cohortSize: number | null;
}

const subjectLink = (subject: string) =>
  `/student/results?subject=${encodeURIComponent(subject)}`;

/** How many days until a date, floored at 0. */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function buildStudentSuggestions(input: SuggestionInput): StudentSuggestion[] {
  const out: StudentSuggestion[] = [];
  const {
    subjects,
    chapters,
    recentScores,
    attendancePct,
    pendingHomework,
    nextExam,
    percentile,
    cohortSize,
  } = input;

  /**
   * The weakest chapter inside a subject, so the advice can point at the exact
   * thing to revise instead of the whole subject. Chapters come from what the
   * teacher tagged the exam with, so a single test can cover several — the test
   * count is shown to keep the claim honest.
   */
  const weakestChapterIn = (subject: string): string | undefined => {
    const inSubject = chapters
      .filter(
        (c): c is SuggestionChapter & { avg_pct: number } =>
          c.avg_pct != null &&
          c.subject.trim().toLowerCase() === subject.trim().toLowerCase(),
      )
      .sort((a, b) => a.avg_pct - b.avg_pct);

    const worst = inSubject[0];

    // No chapter was tagged on any of this subject's exams, so there is nothing
    // to name. Say so rather than staying silent: the student still learns where
    // to ask, and it surfaces the gap for the teacher to fix at exam creation.
    if (!worst) {
      return "Chapter not recorded for these tests. Ask your teacher which chapter to revise.";
    }

    // Shown even when only ONE chapter is recorded: if that is where the marks
    // are being lost, naming it is exactly the point. Wording adapts so a single
    // recorded chapter isn't presented as if it were picked from several.
    const score = `${Math.round(worst.avg_pct)}% across ${
      worst.n_tests === 1 ? "1 test" : `${worst.n_tests} tests`
    }`;
    return inSubject.length > 1
      ? `Weakest chapter: ${worst.chapter} · ${score}`
      : `Chapter tested: ${worst.chapter} · ${score}`;
  };

  const rated = subjects.filter(
    (s): s is SuggestionSubject & { student_avg: number } => s.student_avg != null,
  );

  // 1. Attendance below the threshold — the single biggest lever on marks.
  if (attendancePct != null && attendancePct < ATTENDANCE_WARN_THRESHOLD) {
    out.push({
      id: "attendance",
      priority: 1,
      tone: "rose",
      title: `Attendance is ${Math.round(attendancePct)}%`,
      detail: `Aim for ${ATTENDANCE_WARN_THRESHOLD}% or more. Missed lessons are the hardest thing to catch up on, and it shows in test marks.`,
      action: { label: "See attendance", to: "/student/attendance" },
    });
  }

  // 2. The weakest subject that is genuinely behind the class.
  const behind = rated
    .filter((s) => s.class_avg != null && s.student_avg - s.class_avg < -COMPARISON_BAND)
    .sort((a, b) => a.student_avg - b.student_avg);
  const weakest = behind[0];
  if (weakest && weakest.class_avg != null) {
    const gap = Math.round(weakest.class_avg - weakest.student_avg);
    out.push({
      id: `weak-${weakest.subject}`,
      priority: 2,
      tone: "peach",
      title: `Focus on ${weakest.subject}`,
      detail: `At ${Math.round(weakest.student_avg)}% you're about ${gap} points below the class average. Start with the chapter you scored lowest on and try past questions on it.`,
      pointer: weakestChapterIn(weakest.subject),
      action: { label: `See ${weakest.subject} tests`, to: subjectLink(weakest.subject) },
    });
  }

  // 3. A second subject that is behind — worth naming so it isn't a surprise later.
  const secondWeakest = behind[1];
  if (secondWeakest && secondWeakest.class_avg != null) {
    const gap = Math.round(secondWeakest.class_avg - secondWeakest.student_avg);
    out.push({
      id: `weak2-${secondWeakest.subject}`,
      priority: 5,
      tone: "peach",
      title: `${secondWeakest.subject} needs some time too`,
      detail: `You're around ${gap} points under the class here. A short revision session each week is usually enough to close a gap this size.`,
      pointer: weakestChapterIn(secondWeakest.subject),
      action: { label: `See ${secondWeakest.subject} tests`, to: subjectLink(secondWeakest.subject) },
    });
  }

  // 4. Score dropped between the last two tests.
  if (recentScores.length >= 2) {
    const latest = recentScores[recentScores.length - 1];
    const previous = recentScores[recentScores.length - 2];
    const delta = Math.round(latest - previous);
    if (delta <= -TREND_FLAT_BAND) {
      out.push({
        id: "trend-down",
        priority: 3,
        tone: "peach",
        title: `Your last test dropped ${Math.abs(delta)} points`,
        detail:
          "Go back over that paper and write down every question you lost marks on. Fixing repeated mistakes lifts the next score fastest.",
        action: { label: "Review my results", to: "/student/results" },
      });
    } else if (delta >= TREND_FLAT_BAND) {
      out.push({
        id: "trend-up",
        priority: 9,
        tone: "mint",
        title: `You improved ${delta} points on your last test`,
        detail: "Whatever you changed is working. Keep the same routine going into the next one.",
      });
    }
  }

  // 5. Homework still open.
  if (pendingHomework > 0) {
    out.push({
      id: "homework",
      priority: 4,
      tone: "sky",
      title: `${pendingHomework} homework task${pendingHomework === 1 ? "" : "s"} pending`,
      detail:
        "Finishing these keeps the marks you already earned and stops small gaps turning into big ones.",
      action: { label: "Open homework", to: "/student/homework" },
    });
  }

  // 6. An exam is coming up.
  if (nextExam) {
    const days = daysUntil(nextExam.date);
    out.push({
      id: "next-exam",
      priority: 6,
      tone: "sky",
      title:
        days === 0
          ? `${nextExam.title} is today`
          : `${nextExam.title} in ${days} day${days === 1 ? "" : "s"}`,
      detail:
        "Start with the topics you scored lowest on last time rather than re-reading what you already know.",
      action: { label: "See upcoming exams", to: "/student/exams" },
    });
  }

  // 7. Bottom of the class overall — only when the cohort is big enough to mean something.
  if (percentile != null && cohortSize != null && cohortSize >= 4 && percentile <= 25) {
    out.push({
      id: "standing",
      priority: 7,
      tone: "peach",
      title: "You're in the lower quarter of the class right now",
      detail:
        "Pick one subject to improve at a time. Steady weekly practice moves this more reliably than cramming before a test.",
    });
  }

  // 8. Praise a genuine strength, so the list is never only bad news.
  const ahead = rated
    .filter((s) => s.class_avg != null && s.student_avg - s.class_avg > COMPARISON_BAND)
    .sort((a, b) => b.student_avg - a.student_avg)[0];
  if (ahead && ahead.class_avg != null) {
    const lead = Math.round(ahead.student_avg - ahead.class_avg);
    out.push({
      id: `strong-${ahead.subject}`,
      priority: 8,
      tone: "mint",
      title: `${ahead.subject} is your strongest subject`,
      detail: `You're about ${lead} points above the class average. Keep it up, and use what works here in your weaker subjects.`,
      action: { label: `See ${ahead.subject} tests`, to: subjectLink(ahead.subject) },
    });
  }

  // 9. Nothing measured yet — say so plainly instead of inventing advice.
  if (out.length === 0 && rated.length === 0) {
    return [];
  }

  return out.sort((a, b) => a.priority - b.priority);
}
