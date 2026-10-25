import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { MathText } from "@/components/ui/math-text";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sparkles,
  Loader2,
  Plus,
  Trash2,
  AlertTriangle,
  X,
  BookOpen,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useChapterTopicsByChapters } from "@/hooks/useChapterTopics";
import { useQuestionScope } from "@/hooks/useQuestionScope";
import type { ExamSection, ExamQuestion, QuestionType } from "@/types/exam";
import { SECTION_TYPE_CONFIGS, toDbQuestionType } from "@/types/exam";
import {
  DifficultyChip,
  DEFAULT_DIFFICULTY_LEVEL,
  isMixedDifficulty,
  labelForDifficultyLevel,
  type DifficultyLevel,
} from "@/components/exam-creation/components/DifficultyChip";

/* ─── Local Types ─── */

// Every row keeps one level PER QUESTION (`difficulties.length === count`),
// so a row of 10 can be 6 Hard + 4 Easy. The row chip sets all of them at
// once; the "Per question" expander exposes each one.
interface TopicRowData {
  key: string;
  name: string;
  existingTopicId?: string;
  count: number;
  difficulties: DifficultyLevel[];
  perQuestionOpen: boolean;
}

interface ChapterRowData {
  chapterId: string;
  chapterName: string;
  noTopicCount: number;
  noTopicDifficulties: DifficultyLevel[];
  noTopicPerQuestionOpen: boolean;
  topics: TopicRowData[];
}

// Grow or shrink a per-question level list to `count`, keeping existing
// picks and filling new slots with the row's last pick (or the default).
function resizeLevels(levels: DifficultyLevel[], count: number): DifficultyLevel[] {
  const n = Math.max(0, count);
  if (levels.length === n) return levels;
  if (levels.length > n) return levels.slice(0, n);
  const fill = levels[levels.length - 1] ?? DEFAULT_DIFFICULTY_LEVEL;
  return [...levels, ...Array.from({ length: n - levels.length }, () => fill)];
}

/**
 * Apply a difficulty pick to a row's level array.
 *
 * `qIdx` given: set just that question. Otherwise it is a ROW pick and sets
 * every question in the row. An EMPTY array means the row has no quantity
 * typed yet: keep the pick as a single seed rather than mapping over nothing,
 * because resizeLevels() grows a row using its LAST element as the fill, so a
 * dropped seed silently becomes the Hard default the moment a count arrives.
 */
function applyRowLevel(
  levels: DifficultyLevel[],
  level: DifficultyLevel,
  qIdx?: number,
): DifficultyLevel[] {
  if (qIdx !== undefined) return levels.map((l, q) => (q === qIdx ? level : l));
  return levels.length > 0 ? levels.map(() => level) : [level];
}

// One request per distinct level in a row, preserving first-seen order.
function groupByLevel(levels: DifficultyLevel[]): { level: DifficultyLevel; count: number }[] {
  const out: { level: DifficultyLevel; count: number }[] = [];
  for (const level of levels) {
    const hit = out.find((g) => g.level === level);
    if (hit) hit.count += 1;
    else out.push({ level, count: 1 });
  }
  return out;
}

// One LLM call. Planned up front, from the distribution as typed, so the UI
// can say how many calls a click will make and the cap is judged before
// anything is sent.
interface BatchReq {
  chapterId: string;
  chapterName: string;
  topicName?: string;
  topicExistingId?: string;
  count: number;
  difficultyLevel: DifficultyLevel;
}

// Each request may be retried once and topped up once more (the under-delivery
// net CLAUDE.md §8 keeps), so one click costs up to 2R+1 sequential calls. Ten
// requests is 21 calls; past that the author is asked to simplify the split.
const MAX_BATCH_REQUESTS = 10;

/**
 * A row with one band is one request, as before. A row whose questions differ
 * in band becomes one request per distinct band; `splitRows` counts those, so
 * the author can be told their picks fan out before they press Generate.
 */
function planBatchRequests(chapterRows: ChapterRowData[]): {
  requests: BatchReq[];
  splitRows: number;
} {
  const requests: BatchReq[] = [];
  let splitRows = 0;
  for (const ch of chapterRows) {
    if (ch.noTopicCount > 0) {
      const groups = groupByLevel(resizeLevels(ch.noTopicDifficulties, ch.noTopicCount));
      if (groups.length > 1) splitRows += 1;
      for (const g of groups) {
        requests.push({
          chapterId: ch.chapterId,
          chapterName: ch.chapterName,
          count: g.count,
          difficultyLevel: g.level,
        });
      }
    }
    for (const t of ch.topics) {
      if (t.count > 0 && t.name.trim()) {
        const groups = groupByLevel(resizeLevels(t.difficulties, t.count));
        if (groups.length > 1) splitRows += 1;
        for (const g of groups) {
          requests.push({
            chapterId: ch.chapterId,
            chapterName: ch.chapterName,
            topicName: t.name.trim(),
            topicExistingId: t.existingTopicId,
            count: g.count,
            difficultyLevel: g.level,
          });
        }
      }
    }
  }
  return { requests, splitRows };
}

interface CaseStudyPassage {
  subQuestionCount: number;
}

/* ─── Difficulty ─── */

// The edge function accepts difficultyLevel 1..5. The product default is 5
// ("always hardest, calibrated to grade level", CLAUDE.md §8). Every chapter
// and topic row in the distribution carries its own band chip
// (DifficultyChip.tsx) that starts at that default, so an author who never
// touches a chip gets exactly the old behaviour, and one who does gets that
// row's questions at the band they picked. Early years (Class 1 and below)
// are still clamped server-side.

interface GeneratedSubQuestion {
  text: string;
  marks: number;
  answer: string;
}

interface GeneratedQuestion {
  question_text: string;
  question_type: QuestionType;
  difficulty_level: number;
  marks: number;
  options?: { text: string; is_correct: boolean }[];
  correct_answer?: string;
  explanation?: string;
  tags?: string[];
  negative_marks?: number;
  selected?: boolean;
  evaluation_keywords?: string[];
  core_concepts?: string[];
  sub_questions?: GeneratedSubQuestion[];
  matching_column_a?: string[];
  matching_column_b?: string[];
  // Metadata attached during generation
  _chapterId?: string;
  _chapterName?: string;
  _topicName?: string;
  _topicExistingId?: string;
}

/* ─── Props ─── */

export interface AIGenerateQuestionsProps {
  section: ExamSection;
  questionType: QuestionType;
  remainingSlots: number;
  classId: string;
  subjectId: string;
  subjectName?: string;
  institutionId: string;
  onAddQuestion: (
    sectionTempId: string,
    question: Omit<ExamQuestion, "tempId">
  ) => void;
  onComplete?: () => void;
}

/* ─── Topic Autocomplete Input ─── */

function TopicInput({
  value,
  onChange,
  suggestions,
}: {
  value: string;
  onChange: (name: string, existingId?: string) => void;
  suggestions: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const filtered = suggestions.filter(
    (s) => value && s.name.toLowerCase().includes(value.toLowerCase())
  );

  return (
    <div className="relative flex-1">
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        placeholder="Type topic name..."
        className="h-9 text-sm"
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 max-h-32 overflow-y-auto rounded-md border bg-popover shadow-md">
          {filtered.map((s) => (
            <button
              key={s.id}
              type="button"
              className="w-full px-3 py-2 text-left text-sm hover:bg-accent"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(s.name, s.id);
                setOpen(false);
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Per-question difficulty expander ─── */

// Collapsed: a one-line "Per question" toggle. Open: one mini chip per
// question in the row, wrapping, so a row of 10 can hold 10 different picks
// without the row itself growing until the author asks for it.
function PerQuestionDifficulties({
  levels,
  open,
  onToggle,
  onChange,
  disabled,
}: {
  levels: DifficultyLevel[];
  open: boolean;
  onToggle: () => void;
  onChange: (qIdx: number, level: DifficultyLevel) => void;
  disabled?: boolean;
}) {
  const Icon = open ? ChevronUp : ChevronDown;
  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
        onClick={onToggle}
        aria-expanded={open}
      >
        <Icon className="mr-1 h-3 w-3" aria-hidden />
        Per question
      </Button>
      {open && (
        <div className="flex flex-wrap gap-x-3 gap-y-1.5">
          {levels.map((level, q) => (
            <div key={q} className="flex items-center gap-1">
              <span className="w-5 text-right text-[11px] text-muted-foreground">
                {q + 1}
              </span>
              <DifficultyChip
                level={level}
                onChange={(next) => onChange(q, next)}
                disabled={disabled}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Inline topic upsert (avoids toast spam from mutation hook) ─── */

async function upsertTopicInline(params: {
  institutionId: string;
  classId: string;
  subjectId: string;
  chapterId: string;
  name: string;
}): Promise<string | null> {
  const trimmed = params.name.trim();
  if (!trimmed) return null;

  const { data: classRow } = await supabase
    .from("classes")
    .select("class_group_id")
    .eq("id", params.classId)
    .maybeSingle();
  const classGroupId =
    (classRow as { class_group_id: string | null } | null)?.class_group_id ?? null;
  if (!classGroupId) return null;

  const { data: existing } = await supabase
    .from("chapter_topics")
    .select("id")
    .eq("institution_id", params.institutionId)
    .eq("class_group_id", classGroupId)
    .eq("subject_id", params.subjectId)
    .eq("chapter_id", params.chapterId)
    .eq("name", trimmed)
    .maybeSingle();

  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("chapter_topics")
    .insert({
      institution_id: params.institutionId,
      class_group_id: classGroupId,
      subject_id: params.subjectId,
      chapter_id: params.chapterId,
      name: trimmed,
    })
    .select("id")
    .single();

  if (error) {
    console.error("Failed to upsert topic:", error);
    return null;
  }
  return created.id;
}

/* ─── Main Component ─── */

export function AIGenerateQuestions({
  section,
  questionType,
  remainingSlots,
  classId,
  subjectId,
  subjectName,
  institutionId,
  onAddQuestion,
  onComplete,
}: AIGenerateQuestionsProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const isCaseStudy =
    questionType === "case_study" || questionType === "comprehension";
  const typeLabel =
    SECTION_TYPE_CONFIGS[questionType as keyof typeof SECTION_TYPE_CONFIGS]
      ?.label || questionType;

  /* ─── Fetch chapter names ─── */

  const sectionChapterIds = section.chapterIds || [];

  const { data: chapters, isLoading: chaptersLoading } = useQuery({
    queryKey: ["chapter-names-for-ai", sectionChapterIds],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("syllabus_topics")
        .select("id, topic_name, chapter_number, display_order")
        .in("id", sectionChapterIds)
        .order("display_order");
      if (error) throw error;
      return data || [];
    },
    enabled: sectionChapterIds.length > 0,
  });

  /* ─── Fetch existing topics for autocomplete ─── */

  const { data: existingTopics } = useChapterTopicsByChapters({
    institutionId,
    classId,
    subjectId,
    chapterIds: sectionChapterIds,
  });

  const topicsByChapter = useMemo(() => {
    const map: Record<string, { id: string; name: string }[]> = {};
    (existingTopics || []).forEach((t) => {
      if (!map[t.chapter_id]) map[t.chapter_id] = [];
      map[t.chapter_id].push({ id: t.id, name: t.name });
    });
    return map;
  }, [existingTopics]);

  /* ─── Class-group resolution ─── */
  // Per-upload audience picker was removed; every saved question is class-wide
  // (no rows in question_bank_section_scope). The hook is still used to
  // resolve the class_group_id for the question_bank insert.
  const scope = useQuestionScope({ institutionId, classId, subjectId });

  /* ─── State ─── */

  const [chapterRows, setChapterRows] = useState<ChapterRowData[]>([]);
  // Case study / comprehension is a single request, so it carries one level
  // for every passage instead of a per-row chip.
  const [caseStudyDifficulty, setCaseStudyDifficulty] =
    useState<DifficultyLevel>(DEFAULT_DIFFICULTY_LEVEL);
  const [caseStudies, setCaseStudies] = useState<CaseStudyPassage[]>([
    { subQuestionCount: remainingSlots },
  ]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingProgress, setGeneratingProgress] = useState("");
  const [generatedQuestions, setGeneratedQuestions] = useState<
    GeneratedQuestion[]
  >([]);
  const [isAdding, setIsAdding] = useState(false);
  // Synchronous guard for the "Add Selected" button. State alone has a
  // render-cycle gap that lets a fast double-tap fire handleAddSelected
  // twice — duplicating every question. The ref closes that gap.
  const isAddingRef = useRef(false);
  // Same shape for Generate: a double-tap in the state's render gap used to
  // start a second full fan-out of edge-function calls.
  const isGeneratingRef = useRef(false);
  // The review card renders below the chapter distribution + Generate button,
  // so on a fresh generation it sits under the fold of the bottom sheet. Scroll
  // it into view the moment results land so the author sees them (and the Add
  // button) without hunting for the end of the sheet.
  const reviewRef = useRef<HTMLDivElement>(null);
  const prevGeneratedCount = useRef(0);

  useEffect(() => {
    const count = generatedQuestions.length;
    if (count > 0 && prevGeneratedCount.current === 0) {
      requestAnimationFrame(() => {
        reviewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    prevGeneratedCount.current = count;
  }, [generatedQuestions.length]);

  /* ─── Initialize chapter rows when chapters load ─── */

  useEffect(() => {
    if (!chapters || chapters.length === 0) return;
    if (chapterRows.length > 0) return; // only init once

    const n = chapters.length;
    const perChapter = Math.floor(remainingSlots / n);
    const remainder = remainingSlots % n;

    setChapterRows(
      chapters.map((ch, i) => ({
        chapterId: ch.id,
        chapterName: ch.chapter_number
          ? `Ch ${ch.chapter_number}: ${ch.topic_name}`
          : ch.topic_name,
        noTopicCount: perChapter + (i === 0 ? remainder : 0),
        noTopicDifficulties: resizeLevels([], perChapter + (i === 0 ? remainder : 0)),
        noTopicPerQuestionOpen: false,
        topics: [],
      }))
    );
  }, [chapters, remainingSlots]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ─── Running totals ─── */

  const chapterTotal = useMemo(
    () =>
      chapterRows.reduce(
        (sum, ch) =>
          sum +
          ch.noTopicCount +
          ch.topics.reduce((ts, t) => ts + t.count, 0),
        0
      ),
    [chapterRows]
  );

  const caseStudyTotal = useMemo(
    () => caseStudies.reduce((sum, cs) => sum + cs.subQuestionCount, 0),
    [caseStudies]
  );

  const runningTotal = isCaseStudy ? caseStudyTotal : chapterTotal;
  const isValidTotal = runningTotal === remainingSlots && runningTotal > 0;

  // How many edge-function calls the chapter path will make, from the rows as
  // typed. Case studies are always one call.
  const plan = useMemo(
    () => (isCaseStudy ? { requests: [], splitRows: 0 } : planBatchRequests(chapterRows)),
    [isCaseStudy, chapterRows],
  );
  const overRequestCap = plan.requests.length > MAX_BATCH_REQUESTS;

  /* ─── Chapter row handlers ─── */

  // Row chip: set every question in the row. `qIdx` given: set just that one.
  const updateChapterDifficulty = (
    idx: number,
    level: DifficultyLevel,
    qIdx?: number
  ) => {
    setChapterRows((prev) =>
      prev.map((ch, i) =>
        i === idx
          ? {
              ...ch,
              noTopicDifficulties: applyRowLevel(
                ch.noTopicDifficulties,
                level,
                qIdx
              ),
            }
          : ch
      )
    );
  };

  const toggleChapterPerQuestion = (idx: number) => {
    setChapterRows((prev) =>
      prev.map((ch, i) =>
        i === idx
          ? { ...ch, noTopicPerQuestionOpen: !ch.noTopicPerQuestionOpen }
          : ch
      )
    );
  };

  const updateTopicDifficulty = (
    chapterIdx: number,
    topicIdx: number,
    level: DifficultyLevel,
    qIdx?: number
  ) => {
    setChapterRows((prev) =>
      prev.map((ch, i) => {
        if (i !== chapterIdx) return ch;
        return {
          ...ch,
          topics: ch.topics.map((t, ti) =>
            ti === topicIdx
              ? {
                  ...t,
                  difficulties: applyRowLevel(t.difficulties, level, qIdx),
                }
              : t
          ),
        };
      })
    );
  };

  const toggleTopicPerQuestion = (chapterIdx: number, topicIdx: number) => {
    setChapterRows((prev) =>
      prev.map((ch, i) => {
        if (i !== chapterIdx) return ch;
        return {
          ...ch,
          topics: ch.topics.map((t, ti) =>
            ti === topicIdx ? { ...t, perQuestionOpen: !t.perQuestionOpen } : t
          ),
        };
      })
    );
  };

  const updateChapterCount = (idx: number, count: number) => {
    setChapterRows((prev) =>
      prev.map((ch, i) => {
        if (i !== idx) return ch;
        const next = Math.max(0, count);
        return {
          ...ch,
          noTopicCount: next,
          noTopicDifficulties: resizeLevels(ch.noTopicDifficulties, next),
        };
      })
    );
  };

  const addTopic = (chapterIdx: number) => {
    setChapterRows((prev) =>
      prev.map((ch, i) => {
        if (i !== chapterIdx) return ch;
        return {
          ...ch,
          topics: [
            ...ch.topics,
            {
              key: `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              name: "",
              count: 0,
              difficulties: [],
              perQuestionOpen: false,
            },
          ],
        };
      })
    );
  };

  const removeTopic = (chapterIdx: number, topicIdx: number) => {
    setChapterRows((prev) =>
      prev.map((ch, i) => {
        if (i !== chapterIdx) return ch;
        const removed = ch.topics[topicIdx];
        const nextCount = ch.noTopicCount + removed.count;
        return {
          ...ch,
          noTopicCount: nextCount,
          noTopicDifficulties: resizeLevels(ch.noTopicDifficulties, nextCount),
          topics: ch.topics.filter((_, ti) => ti !== topicIdx),
        };
      })
    );
  };

  const updateTopicName = (
    chapterIdx: number,
    topicIdx: number,
    name: string,
    existingId?: string
  ) => {
    setChapterRows((prev) =>
      prev.map((ch, i) => {
        if (i !== chapterIdx) return ch;
        return {
          ...ch,
          topics: ch.topics.map((t, ti) =>
            ti === topicIdx
              ? { ...t, name, existingTopicId: existingId }
              : t
          ),
        };
      })
    );
  };

  const updateTopicCount = (
    chapterIdx: number,
    topicIdx: number,
    count: number
  ) => {
    setChapterRows((prev) =>
      prev.map((ch, i) => {
        if (i !== chapterIdx) return ch;
        const oldCount = ch.topics[topicIdx].count;
        const delta = count - oldCount;
        const nextNoTopic = Math.max(0, ch.noTopicCount - delta);
        const nextTopic = Math.max(0, count);
        return {
          ...ch,
          noTopicCount: nextNoTopic,
          noTopicDifficulties: resizeLevels(ch.noTopicDifficulties, nextNoTopic),
          topics: ch.topics.map((t, ti) =>
            ti === topicIdx
              ? {
                  ...t,
                  count: nextTopic,
                  difficulties: resizeLevels(t.difficulties, nextTopic),
                }
              : t
          ),
        };
      })
    );
  };

  /* ─── Case study handlers ─── */

  const updatePassageCount = (passageCount: number) => {
    const clamped = Math.max(1, Math.min(10, passageCount));
    setCaseStudies((prev) => {
      if (clamped > prev.length) {
        return [
          ...prev,
          ...Array.from({ length: clamped - prev.length }, () => ({
            subQuestionCount: 0,
          })),
        ];
      }
      return prev.slice(0, clamped);
    });
  };

  const updatePassageSubQuestions = (idx: number, count: number) => {
    setCaseStudies((prev) =>
      prev.map((cs, i) =>
        i === idx ? { ...cs, subQuestionCount: Math.max(0, count) } : cs
      )
    );
  };

  /* ─── Generation ─── */

  const handleGenerate = async () => {
    if (!isValidTotal) return;
    // Synchronous single-flight guard (see isGeneratingRef).
    if (isGeneratingRef.current) return;
    if (overRequestCap) {
      toast({
        title: "Too many separate requests",
        description: `Your band picks split this into ${plan.requests.length} requests. Use at most ${MAX_BATCH_REQUESTS}: give more questions in a row the same band, or use fewer rows.`,
        variant: "destructive",
      });
      return;
    }
    isGeneratingRef.current = true;

    setIsGenerating(true);
    setGeneratedQuestions([]);

    // Reads the JSON body from a FunctionsHttpError (non-2xx) so the server's
    // quota/feature message reaches the user instead of the generic
    // "Edge Function returned a non-2xx status code".
    const readEdgeError = async (
      err: unknown,
    ): Promise<{ error?: string; code?: string } | null> => {
      const ctx = (err as { context?: Response }).context;
      if (!ctx || typeof ctx.clone !== "function") return null;
      try {
        return await ctx.clone().json();
      } catch {
        return null;
      }
    };
    const quotaTitleFor = (code: string) =>
      code === "FEATURE_DISABLED"
        ? "Feature Disabled"
        : code === "INSTITUTION_LIMIT_EXCEEDED"
          ? "Institution Limit Reached"
          : "Daily Limit Reached";
    // Set when the server rejects on a quota/feature gate — retrying cannot
    // succeed, so remaining batches and top-ups must be skipped.
    let generationBlocked = false;

    // The band the server actually generated at. generate-questions returns
    // it as metadata.difficulty; for Class 1 and below it is the early-years
    // clamp (2 or 3), not what was asked. The rows are stamped with THIS, not
    // with whatever level the model echoed, and the author is told once.
    const servedBand = (data: unknown): DifficultyLevel | null => {
      const d = (data as { metadata?: { difficulty?: unknown } } | null)?.metadata?.difficulty;
      return typeof d === "number" && d >= 1 && d <= 5 ? (d as DifficultyLevel) : null;
    };
    const servedGrade = (data: unknown): string | null => {
      const g = (data as { metadata?: { grade?: unknown } } | null)?.metadata?.grade;
      return typeof g === "string" && g ? g : null;
    };
    let clampNotice: { grade: string | null; to: DifficultyLevel } | null = null;
    const noteClamp = (data: unknown, asked: DifficultyLevel) => {
      const served = servedBand(data);
      if (served !== null && served !== asked && !clampNotice) {
        clampNotice = { grade: servedGrade(data), to: served };
      }
      return served ?? asked;
    };

    try {
      const allQuestions: GeneratedQuestion[] = [];

      if (isCaseStudy) {
        // Build combined chapter+topic context for the passage
        const chapterContext = chapterRows
          .map((ch) => {
            const topicNames = ch.topics
              .filter((t) => t.name.trim())
              .map((t) => t.name.trim());
            return topicNames.length > 0
              ? `${ch.chapterName} (Topics: ${topicNames.join(", ")})`
              : ch.chapterName;
          })
          .join("; ");

        setGeneratingProgress(
          `Generating ${questionType === "case_study" ? "case studies" : "comprehension passages"}...`
        );

        const { data, error } = await supabase.functions.invoke(
          "generate-questions",
          {
            body: {
              subjectId,
              subjectName,
              // classId lets the edge function resolve the grade level: this
              // path sends no chapterId, and without a grade the model
              // defaults to "General" and writes board-exam-level questions
              // for every class (see generate-questions grade resolution).
              classId,
              chapterName: chapterContext,
              questionType,
              questionCount: caseStudyTotal,
              difficultyLevel: caseStudyDifficulty,
              caseStudyCount: caseStudies.length,
              subQuestionsPerCaseStudy: caseStudies.map(
                (cs) => cs.subQuestionCount
              ),
              defaultMarks: section.defaultMarks || 1,
              negativeMarking: section.negativeMarking || 0,
            },
          }
        );

        if (error) {
          const body = await readEdgeError(error);
          toast({
            title: body?.code ? quotaTitleFor(body.code) : "Generation failed",
            description:
              body?.error ||
              (error instanceof Error ? error.message : "Failed to generate questions"),
            variant: "destructive",
          });
          return;
        }
        if (data?.error) {
          toast({
            title: data.code === "FEATURE_DISABLED"
              ? "Feature Disabled"
              : data.code === "INSTITUTION_LIMIT_EXCEEDED"
                ? "Institution Limit Reached"
                : data.code === "USER_LIMIT_EXCEEDED"
                  ? "Daily Limit Reached"
                  : "Generation failed",
            description: data.error,
            variant: "destructive",
          });
          return;
        }

        if (data?.questions) {
          const firstChapter = chapterRows[0];
          const band = noteClamp(data, caseStudyDifficulty);
          allQuestions.push(
            ...data.questions.map((q: GeneratedQuestion) => ({
              ...q,
              difficulty_level: band,
              marks: section.defaultMarks || 1,
              negative_marks: section.negativeMarking || 0,
              selected: true,
              _chapterId: firstChapter?.chapterId,
              _chapterName: firstChapter?.chapterName,
            }))
          );
        }
      } else {
        // One request per chapter row and per distinct band within it; the
        // same plan the hint under the total describes, and already capped.
        const requests = plan.requests;

        // Single LLM call for one batch. Returns the mapped, metadata-stamped
        // questions or an empty array if the call failed / returned no rows.
        const invokeBatch = async (
          req: BatchReq,
          countOverride: number,
        ): Promise<GeneratedQuestion[]> => {
          const { data, error } = await supabase.functions.invoke(
            "generate-questions",
            {
              body: {
                subjectId,
                subjectName,
                classId,
                chapterId: req.chapterId,
                chapterName: req.chapterName,
                topicName: req.topicName,
                questionType,
                questionCount: countOverride,
                difficultyLevel: req.difficultyLevel,
                defaultMarks: section.defaultMarks || 1,
                negativeMarking: section.negativeMarking || 0,
              },
            },
          );
          // Names the band as well as the chapter: a row split across bands
          // is several requests, and "Chapter 3 failed" alone does not say
          // which part.
          const batchLabel = `${labelForDifficultyLevel(req.difficultyLevel)} ${typeLabel} for ${req.chapterName}${req.topicName ? ` → ${req.topicName}` : ""}`;
          if (error) {
            const body = await readEdgeError(error);
            if (
              body?.code === "USER_LIMIT_EXCEEDED" ||
              body?.code === "INSTITUTION_LIMIT_EXCEEDED" ||
              body?.code === "FEATURE_DISABLED"
            ) {
              generationBlocked = true;
              toast({
                title: quotaTitleFor(body.code),
                description: body.error,
                variant: "destructive",
              });
              return [];
            }
            toast({
              title: `Couldn't generate ${batchLabel}`,
              description: body?.error || error.message,
              variant: "destructive",
            });
            return [];
          }
          if (data?.error) {
            toast({
              title: `Couldn't generate ${batchLabel}`,
              description: data.error,
              variant: "destructive",
            });
            return [];
          }
          if (!data?.questions) return [];
          const band = noteClamp(data, req.difficultyLevel);
          return (data.questions as GeneratedQuestion[]).map((q) => ({
            ...q,
            difficulty_level: band,
            marks: section.defaultMarks || 1,
            negative_marks: section.negativeMarking || 0,
            selected: true,
            _chapterId: req.chapterId,
            _chapterName: req.chapterName,
            _topicName: req.topicName,
            _topicExistingId: req.topicExistingId,
          }));
        };

        // Per-batch generation with one top-up retry when the LLM returns
        // fewer questions than asked (a frequent occurrence \u2014 models can
        // truncate or drop entries silently).
        // Requests still short after their own retry, so the safety net below
        // can refill each at the band the author actually asked for.
        const shortfalls: { req: BatchReq; missing: number }[] = [];

        for (let i = 0; i < requests.length; i++) {
          if (generationBlocked) break;
          const req = requests[i];
          setGeneratingProgress(
            `Generating ${req.count} ${labelForDifficultyLevel(req.difficultyLevel)} ${typeLabel} for ${req.chapterName}${req.topicName ? ` \u2192 ${req.topicName}` : ""} (${i + 1}/${requests.length})...`,
          );
          const received = await invokeBatch(req, req.count);
          allQuestions.push(...received);
          let delivered = received.length;

          if (delivered < req.count && !generationBlocked) {
            const deficit = req.count - delivered;
            setGeneratingProgress(
              `Topping up ${deficit} more for ${req.chapterName}...`,
            );
            const more = await invokeBatch(req, deficit);
            allQuestions.push(...more);
            delivered += more.length;
          }

          if (delivered < req.count) {
            shortfalls.push({ req, missing: req.count - delivered });
          }
        }

        // Aggregate safety net: refill every request that is STILL short, each
        // at its OWN band. This used to send the whole deficit to the single
        // largest request, which was harmless while a run had one difficulty
        // but now hands back questions at a level the author never picked.
        for (const { req, missing } of shortfalls) {
          if (generationBlocked) break;
          if (allQuestions.length >= chapterTotal) break;
          setGeneratingProgress(
            `Topping up final ${missing} ${labelForDifficultyLevel(req.difficultyLevel)} question${missing === 1 ? "" : "s"}...`,
          );
          const more = await invokeBatch(req, missing);
          allQuestions.push(...more);
        }
      }

      setGeneratedQuestions(allQuestions);
      if (allQuestions.length > 0) {
        const notice: { grade: string | null; to: DifficultyLevel } | null = clampNotice;
        toast({
          title: "Questions generated!",
          description: notice
            ? `${allQuestions.length} questions ready for review. ${notice.grade ?? "This class"} is Class 1 or below, so every question was generated at the ${labelForDifficultyLevel(notice.to)} band regardless of the band picked.`
            : `${allQuestions.length} questions ready for review`,
        });
      }
    } catch (error: unknown) {
      console.error("Generation error:", error);
      toast({
        title: "Generation failed",
        description:
          error instanceof Error ? error.message : "Failed to generate questions",
        variant: "destructive",
      });
    } finally {
      isGeneratingRef.current = false;
      setIsGenerating(false);
      setGeneratingProgress("");
    }
  };

  /* ─── Toggle selection ─── */

  const toggleQuestion = (index: number) => {
    setGeneratedQuestions((prev) =>
      prev.map((q, i) => (i === index ? { ...q, selected: !q.selected } : q))
    );
  };


  /* ─── Accept: add to exam + save to question bank ─── */

  const handleAddSelected = async () => {
    // Synchronous guard — the DB-save loop below takes seconds; without this
    // a fast user can re-tap and duplicate every question into the section.
    if (isAddingRef.current) return;

    const selectedAll = generatedQuestions.filter((q) => q.selected);
    if (selectedAll.length === 0) {
      toast({
        title: "No questions selected",
        description: "Please select at least one question to add",
        variant: "destructive",
      });
      return;
    }

    // Clamp to the section's remaining capacity. Defends against any path
    // that lets selectedAll exceed remainingSlots (stale UI, repeated taps,
    // etc.) so we never overshoot the section's per-type cap.
    const selected = selectedAll.slice(0, remainingSlots);
    if (selected.length === 0) {
      toast({
        title: "Section already full",
        description: "No remaining slots in this section.",
        variant: "destructive",
      });
      return;
    }
    if (selectedAll.length > remainingSlots) {
      toast({
        title: "Section nearly full",
        description: `Adding the first ${remainingSlots} of ${selectedAll.length} selected. No more room.`,
      });
    }

    isAddingRef.current = true;
    setIsAdding(true);

    // 1. Add each question to the exam section
    for (const q of selected) {
      try {
        let matchingData:
          | { columnA: string[]; columnB: string[]; matches?: string }
          | undefined;
        if (q.question_type === "matching") {
          let colA = q.matching_column_a;
          let colB = q.matching_column_b;
          if ((!colA || !colB) && q.options && !Array.isArray(q.options)) {
            const optObj = q.options as unknown as {
              columnA?: string[];
              columnB?: string[];
            };
            colA = optObj.columnA;
            colB = optObj.columnB;
          }
          if (
            Array.isArray(colA) &&
            Array.isArray(colB) &&
            colA.length > 0
          ) {
            matchingData = {
              columnA: colA,
              columnB: colB,
              matches: colA
                .map(
                  (_, i) =>
                    `${i + 1}-${String.fromCharCode(65 + i)}`
                )
                .join(", "),
            };
          }
        }

        let subQuestions: Omit<ExamQuestion, "tempId">[] | undefined;
        if (
          (q.question_type === "comprehension" ||
            q.question_type === "case_study") &&
          Array.isArray(q.sub_questions) &&
          q.sub_questions.length > 0
        ) {
          subQuestions = q.sub_questions.map((sq) => ({
            questionText: sq.text || "",
            questionType: "short_answer" as QuestionType,
            marks: sq.marks || section.defaultMarks || 2,
            negativeMarks: 0,
            options: null,
            correctAnswer: sq.answer || null,
            explanation: null,
            difficultyLevel: q.difficulty_level,
            tags: [],
          }));
        }

        let totalMarks = section.defaultMarks || 1;
        if (subQuestions && subQuestions.length > 0) {
          totalMarks = subQuestions.reduce((sum, sq) => sum + sq.marks, 0);
        }

        let mappedOptions = null;
        if (
          Array.isArray(q.options) &&
          q.question_type !== "matching"
        ) {
          type OptShape = string | { text?: string; is_correct?: boolean; isCorrect?: boolean };
          mappedOptions = (q.options as OptShape[]).map((opt, i) => ({
            id: String.fromCharCode(97 + i),
            text: typeof opt === "string" ? opt : opt.text || "",
            isCorrect:
              typeof opt === "string"
                ? false
                : opt.is_correct || opt.isCorrect || false,
          }));
        }

        const examQuestion: Omit<ExamQuestion, "tempId"> = {
          questionText: q.question_text,
          questionType: q.question_type,
          marks: totalMarks,
          negativeMarks: q.negative_marks || section.negativeMarking || 0,
          options: mappedOptions,
          correctAnswer: q.correct_answer || null,
          explanation: q.explanation || null,
          difficultyLevel: q.difficulty_level,
          tags: q.tags || [],
          matchingData,
          subQuestions: subQuestions as ExamQuestion[] | undefined,
        };
        onAddQuestion(section.tempId, examQuestion);
      } catch (err) {
        console.error("Error adding question:", err, q);
      }
    }

    // Questions are now in the parent's state. Toast the user, close the
    // sheet, and let the question_bank persistence happen in the background.
    // Without this early return the user stares at an open dialog for several
    // seconds while DB writes complete and can re-tap the button.
    toast({
      title: "Questions added!",
      description: `${selected.length} question${selected.length === 1 ? "" : "s"} added to ${section.title}`,
    });
    setGeneratedQuestions([]);
    onComplete?.();

    // 2. Save to question_bank with chapter + topic metadata
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      for (const q of selected) {
        // Resolve chapter_topic_id for topic-tagged questions
        let chapterTopicId: string | null = null;
        if (q._topicName && q._chapterId) {
          chapterTopicId = q._topicExistingId
            ? q._topicExistingId
            : await upsertTopicInline({
                institutionId,
                classId,
                subjectId,
                chapterId: q._chapterId,
                name: q._topicName,
              });
        }

        const isCaseOrComp =
          q.question_type === "case_study" ||
          q.question_type === "comprehension";

        if (
          isCaseOrComp &&
          q.sub_questions &&
          q.sub_questions.length > 0
        ) {
          // Insert parent passage
          const { data: parent, error: parentErr } = await supabase
            .from("question_bank")
            .insert({
              institution_id: institutionId,
              subject_id: subjectId,
              topic_id: q._chapterId || null,
              chapter_topic_id: chapterTopicId,
              class_group_id: scope.classGroupId,
              question_text: q.question_text,
              question_type: toDbQuestionType(q.question_type),
              correct_answer: q.correct_answer || null,
              explanation: q.explanation || null,
              marks: q.marks || section.defaultMarks || 1,
              difficulty_level: q.difficulty_level,
              tags: q.tags || [],
              source: "ai_generated",
              created_by: user.id,
              is_approved: true,
              sub_question_count: q.sub_questions.length,
              parent_question_id: null,
            })
            .select("id")
            .single();

          if (parentErr) {
            console.error("Error saving parent to bank:", parentErr);
            continue;
          }

          // Insert sub-questions linked to parent
          const subInserts = q.sub_questions.map((sq, idx) => ({
            institution_id: institutionId,
            subject_id: subjectId,
            topic_id: q._chapterId || null,
            chapter_topic_id: chapterTopicId,
            class_group_id: scope.classGroupId,
            question_text: sq.text,
            question_type: "short_answer" as const,
            correct_answer: sq.answer || null,
            marks: sq.marks || section.defaultMarks || 2,
            difficulty_level: q.difficulty_level,
            tags: q.tags || [],
            source: "ai_generated",
            created_by: user.id,
            is_approved: true,
            parent_question_id: parent.id,
            sequence_order: idx + 1,
          }));
          const { error: subErr } = await supabase
            .from("question_bank")
            .insert(subInserts);
          if (subErr) {
            console.error("Error saving sub-questions to bank:", subErr);
          }
        } else {
          // Regular (non-parent) question
          const { error: bankErr } = await supabase
            .from("question_bank")
            .insert({
              institution_id: institutionId,
              subject_id: subjectId,
              topic_id: q._chapterId || null,
              chapter_topic_id: chapterTopicId,
              class_group_id: scope.classGroupId,
              question_text: q.question_text,
              question_type: toDbQuestionType(q.question_type),
              options: q.options ? (q.options as unknown as Json) : null,
              correct_answer: q.correct_answer || null,
              explanation: q.explanation || null,
              marks: q.marks || section.defaultMarks || 1,
              difficulty_level: q.difficulty_level,
              tags: q.tags || [],
              source: "ai_generated",
              created_by: user.id,
              is_approved: true,
            });
          if (bankErr) {
            console.error("Error saving to question bank:", bankErr);
          }
        }
      }

      // Invalidate caches
      queryClient.invalidateQueries({ queryKey: ["chapter-topics-multi"] });
      queryClient.invalidateQueries({ queryKey: ["question-bank"] });
    } catch (err) {
      console.error("Error saving to question bank:", err);
    } finally {
      // The component is usually unmounted by the time this runs (sheet was
      // closed via onComplete above). The ref reset is harmless either way
      // and keeps the state consistent if the caller chooses to reuse the
      // mounted component.
      isAddingRef.current = false;
      setIsAdding(false);
    }
  };

  /* ─── Guards ─── */

  if (sectionChapterIds.length === 0) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          No chapters assigned to this section. Go back to assign chapters
          first.
        </AlertDescription>
      </Alert>
    );
  }

  if (chaptersLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  /* ─── Render ─── */

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-primary text-sm">
              Generating {typeLabel}
            </p>
            <p className="text-xs text-muted-foreground">
              for {section.title}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">
            {remainingSlots} slots remaining
          </Badge>
        </div>
      </div>

      {/* Chapter distribution rows */}
      <div className="space-y-3">
        <Label className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          Question Distribution by Chapter
        </Label>

        {chapterRows.map((ch, chIdx) => (
          <Card key={ch.chapterId} className="overflow-hidden">
            <CardContent className="p-3 space-y-3">
              {/* Chapter header */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">
                  {ch.chapterName}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs flex-shrink-0"
                  onClick={() => addTopic(chIdx)}
                >
                  <Plus className="h-3 w-3 mr-1" /> Add Topic
                </Button>
              </div>

              {/* General (no-topic) count */}
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  General (no specific topic):
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={remainingSlots}
                  step={1}
                  value={ch.noTopicCount}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    updateChapterCount(chIdx, isNaN(val) ? 0 : val);
                  }}
                  className="h-8 w-20 text-sm"
                />
                {/* Difficulty for this row's questions; per-passage levels
                    are not possible for case study, so that path uses the
                    single chip in the passages card instead. */}
                {!isCaseStudy && (
                  <DifficultyChip
                    level={ch.noTopicDifficulties[0] ?? DEFAULT_DIFFICULTY_LEVEL}
                    mixed={isMixedDifficulty(ch.noTopicDifficulties)}
                    onChange={(level) => updateChapterDifficulty(chIdx, level)}
                    disabled={isGenerating}
                    className="ml-auto"
                  />
                )}
              </div>

              {/* Per-question levels for the general row */}
              {!isCaseStudy && ch.noTopicCount > 1 && (
                <PerQuestionDifficulties
                  levels={ch.noTopicDifficulties}
                  open={ch.noTopicPerQuestionOpen}
                  onToggle={() => toggleChapterPerQuestion(chIdx)}
                  onChange={(qIdx, level) =>
                    updateChapterDifficulty(chIdx, level, qIdx)
                  }
                  disabled={isGenerating}
                />
              )}

              {/* Topic sub-rows */}
              {ch.topics.map((topic, tIdx) => (
                <div
                  key={topic.key}
                  className="space-y-2 pl-4 border-l-2 border-primary/20"
                >
                <div className="flex items-center gap-2">
                  <TopicInput
                    value={topic.name}
                    onChange={(name, existingId) =>
                      updateTopicName(chIdx, tIdx, name, existingId)
                    }
                    suggestions={topicsByChapter[ch.chapterId] || []}
                  />
                  <Input
                    type="number"
                    min={0}
                    max={remainingSlots}
                    step={1}
                    value={topic.count}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      updateTopicCount(chIdx, tIdx, isNaN(val) ? 0 : val);
                    }}
                    className="h-9 w-16 text-sm"
                    placeholder="Qty"
                  />
                  {!isCaseStudy && (
                    <DifficultyChip
                      level={topic.difficulties[0] ?? DEFAULT_DIFFICULTY_LEVEL}
                      mixed={isMixedDifficulty(topic.difficulties)}
                      onChange={(level) =>
                        updateTopicDifficulty(chIdx, tIdx, level)
                      }
                      disabled={isGenerating}
                    />
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 flex-shrink-0"
                    onClick={() => removeTopic(chIdx, tIdx)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                {!isCaseStudy && topic.count > 1 && (
                  <PerQuestionDifficulties
                    levels={topic.difficulties}
                    open={topic.perQuestionOpen}
                    onToggle={() => toggleTopicPerQuestion(chIdx, tIdx)}
                    onChange={(qIdx, level) =>
                      updateTopicDifficulty(chIdx, tIdx, level, qIdx)
                    }
                    disabled={isGenerating}
                  />
                )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Case study / comprehension passage configuration */}
      {isCaseStudy && (
        <Card>
          <CardContent className="p-3 space-y-3">
            <Label className="text-sm font-medium">
              {questionType === "case_study"
                ? "Case Studies"
                : "Comprehension Passages"}
            </Label>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">
                Number of passages:
              </Label>
              <Input
                type="number"
                min={1}
                max={10}
                step={1}
                value={caseStudies.length}
                onChange={(e) => {
                  const val = parseInt(e.target.value);
                  updatePassageCount(isNaN(val) ? 1 : val);
                }}
                className="h-8 w-20 text-sm"
              />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">
                Difficulty for all passages:
              </Label>
              <DifficultyChip
                level={caseStudyDifficulty}
                onChange={setCaseStudyDifficulty}
                disabled={isGenerating}
              />
            </div>
            {caseStudies.map((cs, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 pl-4 border-l-2 border-primary/20"
              >
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  {questionType === "case_study"
                    ? "Case Study"
                    : "Passage"}{" "}
                  #{idx + 1}:
                </Label>
                <Input
                  type="number"
                  min={0}
                  max={remainingSlots}
                  step={1}
                  value={cs.subQuestionCount}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    updatePassageSubQuestions(idx, isNaN(val) ? 0 : val);
                  }}
                  className="h-8 w-20 text-sm"
                />
                <span className="text-xs text-muted-foreground">
                  sub-questions
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Running total + validation */}
      <div
        className={`rounded-lg border p-3 text-sm ${
          isValidTotal
            ? "border-green-500/30 bg-green-50 dark:bg-green-950/20"
            : "border-destructive/30 bg-destructive/5"
        }`}
      >
        <div className="flex items-center justify-between">
          <span>
            Total questions to generate: <strong>{runningTotal}</strong>
          </span>
          {!isValidTotal && (
            <span className="text-xs text-destructive font-medium">
              Must equal {remainingSlots}
            </span>
          )}
          {isValidTotal && (
            <Badge
              variant="outline"
              className="border-green-500 text-green-700 dark:text-green-400 text-xs"
            >
              Ready
            </Badge>
          )}
        </div>
        {/* Fan-out notice: only when band picks split at least one row, so
            the untouched default (one request per row) stays quiet. */}
        {!isCaseStudy && plan.splitRows > 0 && (
          <p className={`mt-2 text-xs ${overRequestCap ? "font-medium text-destructive" : "text-muted-foreground"}`}>
            {`Mixed bands split ${plan.splitRows} ${plan.splitRows === 1 ? "row" : "rows"}, so this will run as ${plan.requests.length} separate requests`}
            {overRequestCap
              ? `. The limit is ${MAX_BATCH_REQUESTS}: give more questions in a row the same band, or use fewer rows.`
              : ", one per band. Generation takes a little longer."}
          </p>
        )}
      </div>

      {/* Generate button */}
      <Button
        onClick={handleGenerate}
        disabled={isGenerating || !isValidTotal || overRequestCap}
        className="w-full"
      >
        {isGenerating ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            <span className="truncate text-sm">
              {generatingProgress || "Generating..."}
            </span>
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4 mr-2" />
            Generate {runningTotal} {typeLabel}
          </>
        )}
      </Button>

      {/* Generated questions review */}
      {generatedQuestions.length > 0 && (
        <Card ref={reviewRef} className="scroll-mt-4">
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                Review (
                {generatedQuestions.filter((q) => q.selected).length}/
                {generatedQuestions.length} selected)
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setGeneratedQuestions([])}
              >
                <Trash2 className="h-3 w-3 mr-1" /> Clear
              </Button>
            </div>

            {/* Add button sits ABOVE the list so it is visible as soon as the
                card scrolls into view; the list below is capped and scrolls
                on its own, so nothing here depends on reaching its end. */}
            <Button
              onClick={handleAddSelected}
              disabled={
                isAdding ||
                generatedQuestions.filter((q) => q.selected).length === 0
              }
              className="w-full"
            >
              {isAdding ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Selected to {section.title}
                </>
              )}
            </Button>

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {generatedQuestions.map((q, index) => (
                <div
                  key={index}
                  className={`rounded-lg border p-3 ${
                    q.selected
                      ? "border-primary/30 bg-primary/5"
                      : "opacity-50"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <Checkbox
                      checked={q.selected}
                      onCheckedChange={() => toggleQuestion(index)}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <MathText as="p" className="text-sm" text={q.question_text} />
                      <div className="flex flex-wrap gap-1 mt-1">
                        <Badge variant="outline" className="text-xs">
                          {q.question_type.replace("_", " ")}
                        </Badge>
                        <Badge variant="secondary" className="text-xs">
                          {q.marks}m
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {labelForDifficultyLevel(q.difficulty_level)}
                        </Badge>
                        {q._chapterName && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-accent/50"
                          >
                            {q._chapterName}
                          </Badge>
                        )}
                        {q._topicName && (
                          <Badge
                            variant="outline"
                            className="text-xs bg-accent/50"
                          >
                            {q._topicName}
                          </Badge>
                        )}
                      </div>

                      {/* MCQ options */}
                      {Array.isArray(q.options) &&
                        q.question_type !== "matching" && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {(q.options as Array<
                              string | { text?: string; is_correct?: boolean; isCorrect?: boolean }
                            >).map((opt, i) => {
                              const isCorrect =
                                typeof opt === "string"
                                  ? false
                                  : opt.is_correct || opt.isCorrect;
                              const text = typeof opt === "string" ? opt : opt.text;
                              return (
                              <span
                                key={i}
                                className={
                                  isCorrect ? "text-green-600 font-medium" : ""
                                }
                              >
                                {String.fromCharCode(65 + i)}){" "}
                                <MathText text={text} />
                                {i < q.options!.length - 1 ? " | " : ""}
                              </span>
                              );
                            })}
                          </div>
                        )}

                      {/* Matching columns */}
                      {q.question_type === "matching" &&
                        (() => {
                          let colA = q.matching_column_a;
                          let colB = q.matching_column_b;
                          if (
                            (!colA || !colB) &&
                            q.options &&
                            !Array.isArray(q.options)
                          ) {
                            const optObj = q.options as unknown as {
                              columnA?: string[];
                              columnB?: string[];
                            };
                            colA = optObj.columnA;
                            colB = optObj.columnB;
                          }
                          if (
                            !Array.isArray(colA) ||
                            !Array.isArray(colB)
                          )
                            return null;
                          return (
                            <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                              <div>
                                <p className="font-medium text-muted-foreground">
                                  Column A
                                </p>
                                {colA.map(
                                  (item: string, i: number) => (
                                    <p
                                      key={i}
                                      className="text-muted-foreground"
                                    >
                                      {i + 1}. <MathText text={item} />
                                    </p>
                                  )
                                )}
                              </div>
                              <div>
                                <p className="font-medium text-muted-foreground">
                                  Column B
                                </p>
                                {colB.map(
                                  (item: string, i: number) => (
                                    <p
                                      key={i}
                                      className="text-muted-foreground"
                                    >
                                      {String.fromCharCode(65 + i)}.{" "}
                                      <MathText text={item} />
                                    </p>
                                  )
                                )}
                              </div>
                            </div>
                          );
                        })()}

                      {/* Sub-questions for comprehension / case study */}
                      {(q.question_type === "comprehension" ||
                        q.question_type === "case_study") &&
                        q.sub_questions &&
                        q.sub_questions.length > 0 && (
                          <div className="mt-1 p-2 bg-muted/50 rounded text-xs">
                            <p className="font-medium text-muted-foreground mb-1">
                              Sub-questions ({q.sub_questions.length}):
                            </p>
                            {q.sub_questions.map((sq, i) => (
                              <p
                                key={i}
                                className="text-muted-foreground"
                              >
                                {i + 1}. <MathText text={sq.text} /> ({sq.marks}m)
                              </p>
                            ))}
                          </div>
                        )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
