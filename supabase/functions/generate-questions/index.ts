import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import { generateCompletion, AiProviderError } from "../_shared/aiProvider.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Repair unescaped LaTeX backslashes in raw JSON before JSON.parse.
// Models frequently emit "\frac{1}{\eta} \times ..." as JSON string content,
// where \f becomes form-feed, \t becomes tab, \b backspace, etc. — silently
// destroying every LaTeX command. We walk the JSON character-by-character,
// and inside string literals double any backslash that is clearly the start
// of a LaTeX command. Proper JSON escapes (\n, \t, \" alone, \uXXXX,
// already-doubled \\) are preserved.
//
// For the ambiguous control letters (\b \f \n \r \t) the letter run after
// the backslash must be a KNOWN LaTeX command — "\frac", "\neq", "\times" —
// to count as LaTeX. A plain prose word there ("\nhave", "\nthe") is a real
// paragraph break and must stay a whitespace escape: reasoning models emit
// multi-line question text, and the old any-letter rule mangled every
// paragraph break into a literal "\n" in student-facing text.
const LATEX_CONTROL_COMMANDS = new Set([
  // b…
  "backslash", "bar", "bcancel", "because", "begin", "beta", "big", "bigcap",
  "bigcup", "bigg", "biggl", "biggr", "bigl", "bigoplus", "bigotimes", "bigr",
  "bigsqcup", "bigstar", "bigtriangledown", "bigtriangleup", "biguplus",
  "bigvee", "bigwedge", "binom", "bmod", "boldsymbol", "bot", "bowtie",
  "boxed", "breve", "bullet",
  // f…
  "fallingdotseq", "fbox", "flat", "forall", "frac", "frown",
  // n…
  "nabla", "natural", "ncong", "ne", "nearrow", "neg", "neq", "newline",
  "nexists", "ngeq", "ngtr", "ni", "nleftarrow", "nleq", "nless", "nmid",
  "nolimits", "nonumber", "not", "notin", "nparallel", "nprec", "nrightarrow",
  "nsim", "nsubseteq", "nsucc", "nsupseteq", "nu", "nvdash", "nwarrow",
  // r…
  "rangle", "rbrace", "rbrack", "rceil", "rfloor", "rho", "right",
  "rightarrow", "rightharpoondown", "rightharpoonup", "rightleftharpoons",
  "rightsquigarrow", "risingdotseq", "rm", "rtimes",
  // t…
  "tan", "tanh", "tau", "tbinom", "text", "textbf", "textit", "textrm",
  "tfrac", "therefore", "theta", "thickapprox", "thicksim", "tilde", "times",
  "to", "top", "triangle", "triangledown", "triangleleft", "triangleq",
  "triangleright", "twoheadleftarrow", "twoheadrightarrow",
]);

function repairLatexEscapes(json: string): string {
  let out = '';
  let inString = false;
  let i = 0;
  while (i < json.length) {
    const ch = json[i];
    if (!inString) {
      if (ch === '"') inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = false;
      out += ch;
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < json.length) {
      const next = json[i + 1];
      if (next === '\\' || next === '"' || next === '/') {
        out += ch + next;
        i += 2;
        continue;
      }
      if (next === 'u' && /^[0-9a-fA-F]{4}$/.test(json.slice(i + 2, i + 6))) {
        out += json.slice(i, i + 6);
        i += 6;
        continue;
      }
      // JSON control-char escapes (\b \f \n \r \t): LaTeX only when the
      // maximal letter run after the backslash is a known LaTeX command
      // (\frac, \neq, \tau ...). Anything else — isolated \n, or a paragraph
      // break before a prose word like "\nhave" — stays a whitespace escape.
      if (['b', 'f', 'n', 'r', 't'].includes(next)) {
        let j = i + 1;
        while (j < json.length && /[a-zA-Z]/.test(json[j])) j++;
        const word = json.slice(i + 1, j);
        // A period right after the run ("\ni.e.", "\ne.g.") is prose after a
        // newline, never a LaTeX command boundary.
        if (word.length > 1 && json[j] !== '.' && LATEX_CONTROL_COMMANDS.has(word)) {
          out += '\\\\' + next;
          i += 2;
          continue;
        }
        out += ch + next;
        i += 2;
        continue;
      }
      if (/[a-zA-Z]/.test(next)) {
        // Any other backslash-letter (\e, \v, \alpha, \sum ...) is LaTeX.
        out += '\\\\' + next;
        i += 2;
        continue;
      }
      // Backslash + anything else (\, \; \{ \} \$ \% \& ...) is an invalid
      // JSON escape that would make JSON.parse throw — and in model output
      // it is always LaTeX punctuation, so double it too.
      out += '\\\\' + next;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

interface QuestionGenerationRequest {
  topicId?: string;
  topicIds?: string[];
  customTopicIds?: string[];
  gradeId?: string;
  subjectId?: string;
  sectionType?: string;
  questionTypes: ('mcq' | 'short_answer' | 'long_answer' | 'true_false' | 'fill_blank' | 'matching' | 'comprehension' | 'case_study')[];
  difficultyLevel: 1 | 2 | 3 | 4 | 5;
  count: number;
  includeExplanations?: boolean;
  customTopic?: string;
  customDescription?: string;
  // Phase 3: chapter + topic context
  chapterId?: string;
  chapterName?: string;
  /** Fallback for grade resolution when chapterId is absent (case-study path). */
  classId?: string;
  topicName?: string;
  questionType?: string;       // single type (new callers)
  questionCount?: number;      // exact count (new callers)
  caseStudyCount?: number;
  subQuestionsPerCaseStudy?: number[];
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // NOTE: LLM provider selection is centralized in ../_shared/aiProvider.ts.
    // This function calls `generateCompletion(...)` below — swap providers via
    // the AI_PROVIDER env var (default "openai", using OPENAI_API_KEY).
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const requestBody = await req.json() as QuestionGenerationRequest & { subjectName?: string };
    const requestedCount = requestBody.questionCount || requestBody.count || 5;

    const authHeader = req.headers.get('Authorization');
    let userId: string | null = null;
    
    if (authHeader) {
      const token = authHeader.replace('Bearer ', '');
      const { data: { user } } = await supabase.auth.getUser(token);
      userId = user?.id || null;
    }

    // Quota state shared between the pre-generation check and the
    // post-generation usage update below.
    let localToday = new Date().toISOString().split('T')[0];
    let userInstitutionId: string | null = null;

    // Check user's daily question limit and institution quota
    if (userId) {
      // Get user's profile for institution_id + timezone. §24: "today" must
      // be the school's wall-clock day, not UTC — a UTC boundary would reset
      // quotas at 05:30 IST and let an evening user double-dip.
      const { data: userProfile } = await supabase
        .from('profiles')
        .select('institution_id, institutions(timezone)')
        .eq('id', userId)
        .maybeSingle();
      userInstitutionId = userProfile?.institution_id ?? null;
      const instJoin = userProfile?.institutions as
        | { timezone?: string }
        | { timezone?: string }[]
        | null;
      const tz =
        (Array.isArray(instJoin) ? instJoin[0]?.timezone : instJoin?.timezone) ||
        'Asia/Kolkata';
      // en-CA locale formats as YYYY-MM-DD
      localToday = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
      const today = localToday;

      // Check institution-level AI quota
      if (userProfile?.institution_id) {
        const { data: institutionQuota } = await supabase
          .from('ai_usage_quotas')
          .select('*')
          .eq('institution_id', userProfile.institution_id)
          .maybeSingle();

        if (institutionQuota) {
          // Check if question generation is enabled
          if (!institutionQuota.question_generation_enabled) {
            return new Response(JSON.stringify({ 
              error: "AI question generation is disabled for your institution.",
              code: "FEATURE_DISABLED",
            }), {
              status: 403,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }

          // Check daily token limit for institution
          const { data: dailyUsage } = await supabase
            .from('ai_daily_usage')
            .select('questions_generated')
            .eq('institution_id', userProfile.institution_id)
            .eq('usage_date', today)
            .maybeSingle();

          const currentInstitutionUsage = dailyUsage?.questions_generated || 0;
          
          if (institutionQuota.daily_question_limit > 0 && 
              currentInstitutionUsage + requestedCount > institutionQuota.daily_question_limit) {
            return new Response(JSON.stringify({ 
              error: `Institution daily limit reached. ${institutionQuota.daily_question_limit - currentInstitutionUsage} questions remaining.`,
              code: "INSTITUTION_LIMIT_EXCEEDED",
              remaining: Math.max(0, institutionQuota.daily_question_limit - currentInstitutionUsage),
            }), {
              status: 429,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
          }
        }
      }
      
      // Per-user daily quota (2026-07-25): default 100 questions/day for
      // everyone. A row with daily_limit > 0 is an admin-set override; the
      // row is created lazily after a user's first generation, so a missing
      // row still gets the default enforced.
      const DEFAULT_USER_DAILY_LIMIT = 100;
      const { data: userLimit } = await supabase
        .from('user_question_limits')
        .select('id, daily_limit, questions_used_today, last_reset_date')
        .eq('user_id', userId)
        .maybeSingle();

      let currentUsed = 0;
      let effectiveLimit = DEFAULT_USER_DAILY_LIMIT;
      if (userLimit) {
        currentUsed = userLimit.questions_used_today;
        // Reset count if new day (institution-local)
        if (userLimit.last_reset_date !== today) {
          currentUsed = 0;
          await supabase
            .from('user_question_limits')
            .update({ questions_used_today: 0, last_reset_date: today })
            .eq('id', userLimit.id);
        }
        if (userLimit.daily_limit > 0) {
          effectiveLimit = userLimit.daily_limit;
        }
      }

      if (currentUsed + requestedCount > effectiveLimit) {
        const remaining = Math.max(0, effectiveLimit - currentUsed);
        return new Response(JSON.stringify({
          error: remaining === 0
            ? `You have used your daily question generation quota (${effectiveLimit} questions). It resets tomorrow.`
            : `Only ${remaining} of your ${effectiveLimit} daily questions are left. Reduce the count or try again tomorrow.`,
          code: "USER_LIMIT_EXCEEDED",
          remaining,
          limit: effectiveLimit,
        }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const {
      topicId,
      topicIds,
      customTopicIds,
      gradeId,
      subjectId,
      sectionType,
      questionTypes: origQuestionTypes,
      difficultyLevel,
      count: origCount,
      includeExplanations = true,
      customTopic: origCustomTopic,
      customDescription,
      subjectName: requestSubjectName,
    } = requestBody;

    // Phase 3: override with chapter-based fields when present
    let customTopic = origCustomTopic;
    let count = origCount;
    let questionTypes = origQuestionTypes;

    if (requestBody.chapterName) {
      const tName = requestBody.topicName;
      customTopic = tName
        ? `${requestBody.chapterName} — ${tName}`
        : requestBody.chapterName;
    }
    if (requestBody.questionType) {
      questionTypes = [requestBody.questionType as QuestionGenerationRequest['questionTypes'][number]];
    }
    if (requestBody.questionCount) {
      count = requestBody.questionCount;
    }

    console.log('Generating questions for:', { topicId, topicIds, customTopicIds, sectionType, questionTypes, difficultyLevel, count, chapterName: requestBody.chapterName, topicName: requestBody.topicName });

    // Shape used for prompt-building; PostgREST joins land as single objects
    // here (many-to-one relations).
    type TopicForPrompt = {
      id: string | null;
      topic_name: string;
      description: string;
      keywords: string[];
      learning_objectives: unknown[];
      grade_levels?: { grade_name?: string; grade_number?: number } | null;
      universal_subjects?: { name?: string; code?: string } | null;
    };
    let topics: TopicForPrompt[] = [];
    let gradeName = 'General';
    let gradeNumber: number | null = null;
    let subjectName = 'General';

    // Support custom topic without needing a database topic
    if (customTopic) {
      topics = [{
        id: null,
        topic_name: customTopic,
        description: customDescription || '',
        learning_objectives: [],
        keywords: [],
      }];
    } else if (topicIds && topicIds.length > 0) {
      // Fetch multiple universal topics
      const { data: universalTopics, error: topicsError } = await supabase
        .from('syllabus_topics')
        .select(`
          id,
          topic_name,
          learning_outcomes,
          sub_topics,
          grade_level_id,
          subject_id,
          grade_levels(grade_name, grade_number),
          universal_subjects(name, code)
        `)
        .in('id', topicIds);

      if (topicsError) {
        console.error('Error fetching topics:', topicsError);
        throw new Error(`Failed to fetch topics: ${topicsError.message}`);
      }

      topics = (universalTopics || []).map(t => ({
        ...t,
        description: Array.isArray(t.sub_topics) ? t.sub_topics.join(', ') : '',
        keywords: [],
        learning_objectives: t.learning_outcomes || [],
      }));
      if (topics.length > 0) {
        gradeName = topics[0].grade_levels?.grade_name || 'General';
        gradeNumber = topics[0].grade_levels?.grade_number ?? null;
        subjectName = topics[0].universal_subjects?.name || 'General';
      }
    } else if (customTopicIds && customTopicIds.length > 0) {
      // Fetch school custom topics
      const { data: schoolTopics, error: customError } = await supabase
        .from('school_custom_topics')
        .select(`
          id,
          topic_name,
          description,
          grade_level_id,
          subject_id,
          grade_levels(grade_name),
          universal_subjects(name)
        `)
        .in('id', customTopicIds);

      if (customError) {
        console.error('Error fetching custom topics:', customError);
        throw new Error(`Failed to fetch custom topics: ${customError.message}`);
      }

      topics = (schoolTopics || []).map(t => ({
        id: t.id,
        topic_name: t.topic_name,
        description: t.description || '',
        learning_objectives: [],
        keywords: [],
        grade_levels: t.grade_levels,
        universal_subjects: t.universal_subjects,
      }));

      if (topics.length > 0) {
        gradeName = topics[0].grade_levels?.grade_name || 'General';
        subjectName = topics[0].universal_subjects?.name || 'General';
      }
    } else if (topicId) {
      // Single topic ID (backward compatibility)
      const { data: singleTopic, error: singleError } = await supabase
        .from('syllabus_topics')
        .select(`
          id,
          topic_name,
          learning_outcomes,
          sub_topics,
          grade_level_id,
          subject_id,
          grade_levels(grade_name, grade_number),
          universal_subjects(name, code)
        `)
        .eq('id', topicId)
        .single();

      if (singleError) {
        console.error('Error fetching topic:', singleError);
        throw new Error(`Failed to fetch topic: ${singleError.message}`);
      }

      topics = [{
        ...singleTopic,
        description: Array.isArray(singleTopic.sub_topics) ? singleTopic.sub_topics.join(', ') : '',
        keywords: [],
        learning_objectives: singleTopic.learning_outcomes || [],
      }];
      gradeName = singleTopic.grade_levels?.grade_name || 'General';
      gradeNumber = singleTopic.grade_levels?.grade_number ?? null;
      subjectName = singleTopic.universal_subjects?.name || 'General';
    } else if (gradeId && subjectId) {
      // Fetch by grade and subject
      const { data: fetchedTopics, error: fetchError } = await supabase
        .from('syllabus_topics')
        .select(`
          id,
          topic_name,
          learning_outcomes,
          sub_topics,
          grade_level_id,
          subject_id,
          grade_levels(grade_name, grade_number),
          universal_subjects(name, code)
        `)
        .eq('grade_level_id', gradeId)
        .eq('subject_id', subjectId)
        .limit(5);

      if (fetchError) {
        console.error('Error fetching topics:', fetchError);
        throw new Error(`Failed to fetch topics: ${fetchError.message}`);
      }

      topics = (fetchedTopics || []).map(t => ({
        ...t,
        description: Array.isArray(t.sub_topics) ? t.sub_topics.join(', ') : '',
        keywords: [],
        learning_objectives: t.learning_outcomes || [],
      }));
      if (topics.length > 0) {
        gradeName = topics[0].grade_levels?.grade_name || 'General';
        gradeNumber = topics[0].grade_levels?.grade_number ?? null;
        subjectName = topics[0].universal_subjects?.name || 'General';
      }
    }

    if (topics.length === 0) {
      throw new Error('No topics found. Please provide topic IDs, custom topic, or grade+subject combination.');
    }

    // Fallback: resolve subject name from subjectId when not resolved from topic joins
    if (subjectName === 'General' && subjectId) {
      const { data: subjectRow } = await supabase
        .from('universal_subjects')
        .select('name')
        .eq('id', subjectId)
        .maybeSingle();
      if (subjectRow?.name) {
        subjectName = subjectRow.name;
      }
    }

    // ── Grade resolution (2026-07-25) — CRITICAL, do not remove ──
    // The chapter-based path (the ONLY path the mobile exam flow uses) builds
    // a synthetic topic with no grade join, so gradeName stayed 'General' for
    // every generation: the model was told to write "the hardest question for
    // grade General" whether the class was Nursery or Class 12. That is how
    // the Nursery chapter "Letter B" produced persuasive-letter-writing
    // questions. Resolve the real grade from the chapter (authoritative —
    // every syllabus_topics row has grade_level_id), falling back to the
    // class group (nullable for some pre-primary rows, hence second).
    if (gradeNumber === null && requestBody.chapterId) {
      const { data: chapterRow } = await supabase
        .from('syllabus_topics')
        .select('grade_levels(grade_name, grade_number)')
        .eq('id', requestBody.chapterId)
        .maybeSingle();
      const gl = chapterRow?.grade_levels as
        | { grade_name?: string; grade_number?: number }
        | { grade_name?: string; grade_number?: number }[]
        | null;
      const row = Array.isArray(gl) ? gl[0] : gl;
      if (row?.grade_number !== undefined && row?.grade_number !== null) {
        gradeNumber = row.grade_number;
        if (row.grade_name) gradeName = row.grade_name;
      }
    }
    if (gradeNumber === null && requestBody.classId) {
      const { data: classRow } = await supabase
        .from('classes')
        .select('class_groups(grade_levels(grade_name, grade_number))')
        .eq('id', requestBody.classId)
        .maybeSingle();
      const cg = classRow?.class_groups as
        | { grade_levels?: { grade_name?: string; grade_number?: number } | { grade_name?: string; grade_number?: number }[] | null }
        | { grade_levels?: { grade_name?: string; grade_number?: number } | { grade_name?: string; grade_number?: number }[] | null }[]
        | null;
      const cgRow = Array.isArray(cg) ? cg[0] : cg;
      const gl = cgRow?.grade_levels;
      const row = Array.isArray(gl) ? gl[0] : gl;
      if (row?.grade_number !== undefined && row?.grade_number !== null) {
        gradeNumber = row.grade_number;
        if (row.grade_name) gradeName = row.grade_name;
      }
    }
    console.log(`Grade resolved: name="${gradeName}" number=${gradeNumber}`);

    // Combine topic information for the prompt
    const topicNames = topics.map(t => t.topic_name).join(', ');
    const topicDescriptions = topics.map(t => t.description).filter(Boolean).join('\n');
    const allKeywords = topics.flatMap(t => t.keywords || []);
    const allObjectives = topics.flatMap(t => t.learning_objectives || []);

    // Build the AI prompt with all 8 question types
    const questionTypeDescriptions: Record<string, string> = {
      mcq: 'Multiple Choice Questions (4 options with one correct answer)',
      short_answer: 'Short Answer Questions (1-2 sentence response expected)',
      long_answer: 'Long Answer Questions (paragraph or essay response expected)',
      true_false: 'True/False Questions',
      fill_blank: 'Fill in the Blank Questions (use ____ for blanks)',
      matching: 'Matching Questions (provide Column A and Column B items as arrays inside options field)',
      comprehension: `Reading Comprehension (generate exactly 1 passage with exactly ${count} sub-questions in the sub_questions array)`,
      case_study: `Case Study (generate exactly 1 scenario with exactly ${count} sub-questions in the sub_questions array)`
    };

    const difficultyDescriptions: Record<number, string> = {
      1: 'Very Easy (basic recall)',
      2: 'Easy (simple understanding)',
      3: 'Medium (application of concepts)',
      4: 'Hard (analysis and synthesis)',
      5: `HARDEST — highest-order thinking questions that are genuinely challenging for a top student at grade "${gradeName}". Match the rigor of the hardest problems found in board/competitive exams at this grade (e.g. CBSE/ICSE board HOTS, JEE/NEET-style for Class 11-12 Science, Olympiad-style for lower grades). Absolutely NO basic/recall/definition questions. Every question must require multi-step reasoning, non-trivial problem solving, edge cases, conceptual traps, or synthesis of multiple concepts.`
    };

    // ── Early-years calibration (2026-07-25) ──
    // Class 1 and below get EASY-to-MEDIUM, never the level-5 board/JEE
    // framing. Pre-primary grade_numbers are NEGATIVE (Pre Nursery -4,
    // Nursery -3, LKG -2, UKG -1 and 0 — there are two UKG rows), so the
    // test is `<= 1`, not `<= 1 && > 0`. Class 2+ is deliberately unchanged.
    // This does not violate the "always hardest" product rule in CLAUDE.md
    // §8: that rule reads "hardest, CALIBRATED TO GRADE LEVEL", and for a
    // four-year-old the calibrated ceiling IS easy-to-medium.
    const isEarlyYears = gradeNumber !== null && gradeNumber <= 1;
    const isPrePrimary = gradeNumber !== null && gradeNumber <= 0;
    // Easy for pre-primary, Medium for Class 1 = the "easy to medium" band.
    const effectiveDifficulty = isEarlyYears
      ? (isPrePrimary ? 2 : 3)
      : difficultyLevel;

    if (isEarlyYears) {
      difficultyDescriptions[effectiveDifficulty] =
        `${isPrePrimary ? 'EASY' : 'EASY to MEDIUM'} — calibrated for "${gradeName}" (early years). These are children aged roughly 3 to 6 who are only beginning to read, write and count. Recognition and recall are exactly what you SHOULD test here. A hard question is a FAILURE at this grade.

MANDATORY EARLY-YEARS RULES (override every difficulty instruction above):
 - ONE single idea per question, answerable in one step. No multi-step reasoning, no trick options, no "which of the following statements is always true".
 - Question text must be SHORT (under about 15 words) and use words a ${gradeName} child already knows.
 - Options must be single words, single numbers, or very short phrases — never full sentences or explanations.
 - MATHS: only small whole numbers inside the range the chapter itself teaches (a "Counting 1 to 5" chapter must never use 6). NO negative numbers, NO fractions, NO decimals, NO algebra or unknowns, NO probability, NO parity/"always true" generalisations, NO word problems needing two operations.
 - ENGLISH: a chapter named "Letter B", "Alphabet A", "Letters A to Z" or similar means the ALPHABET LETTER. Ask about letter recognition, its sound, uppercase/lowercase, or words that begin with it. NEVER interpret "letter" as a written message, correspondence, or mail — that is a severe error at this grade.
 - Prefer everyday concrete objects the child can picture (apple, ball, cat, dog).
 - **SELF-CONTAINED — THE MOST COMMON FAILURE.** There is NO picture attached to the question. NEVER write "How many apples are there?", "Count the dogs", "Which picture shows...", or anything that refers to an image, or to objects that do not physically appear in the question text. Those are UNANSWERABLE and are a HARD FAIL.
   WRONG: "How many apples are there?"  (nothing to count)
   RIGHT: "Count: apple, apple, apple. How many apples?"
   RIGHT: "How many wheels does a bicycle have?"  (general knowledge, needs no picture)
   Every counting question MUST spell out the items to be counted inside question_text, or use a symbol run such as "🍎 🍎 🍎" / "* * *". Read each question back and ask: could a child answer this with ONLY the words in front of them? If no, rewrite it.`;
    }

    // Fix #7: Use requestSubjectName if provided, otherwise use resolved subjectName
    const finalSubjectName = requestSubjectName || subjectName;

    // Cost routing (2026-07-25, narrowed same day per user decision): ONLY
    // Maths + science-family subjects (Science, Physics, Chemistry, Biology)
    // use the reasoning model. Everything else — including Economics,
    // Accountancy, Statistics, and Computer Science — rides the cheap model;
    // revisit if wrong numericals get reported from those. "Social Science"
    // must NOT match the science test. Unresolved 'General' keeps the safe
    // reasoning default (effectively a dead path in the current flow, which
    // always passes subjectName).
    //
    // Per-institution science downgrade (2026-07-25, revenue decision):
    // institutions listed in the REASONING_SCIENCE_EXCLUDE_INSTITUTIONS
    // secret (comma-separated ids; currently Alliance) get the cheap model
    // for science-family subjects too — only Maths stays on reasoning for
    // them. Unset secret = no downgrades. Remove an id to restore premium
    // science for that school (no redeploy needed).
    const isSocialScience = /social/i.test(finalSubjectName);
    const isMath = /math/i.test(finalSubjectName);
    const isScienceFamily =
      !isSocialScience && /science|physics|chem|biolog/i.test(finalSubjectName);
    const scienceDowngradedInstitutions = (
      Deno.env.get('REASONING_SCIENCE_EXCLUDE_INSTITUTIONS') || ''
    )
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const scienceDowngraded =
      userInstitutionId !== null &&
      scienceDowngradedInstitutions.includes(userInstitutionId);
    // Early years never needs the reasoning model (2026-07-25): "count the
    // apples" and "which word begins with B" are trivial for the cheap model,
    // and the reasoning tier costs ~10x for zero quality gain at Class 1 and
    // below. This overrides the Maths/science routes above — grade wins.
    const needsReasoning =
      !isEarlyYears && (
        finalSubjectName === 'General' ||
        isMath ||
        (isScienceFamily && !scienceDowngraded)
      );
    const basicModel = Deno.env.get('OPENAI_MODEL_BASIC') || 'gpt-4o-mini';
    // undefined = let aiProvider resolve OPENAI_MODEL (the reasoning tier)
    const routedModel = needsReasoning ? undefined : basicModel;
    console.log(`Model route: subject="${finalSubjectName}" -> ${routedModel ?? 'reasoning (OPENAI_MODEL)'}`);

    // Detect non-English language subjects
    const hindiKeywords = ['hindi', 'हिंदी', 'हिन्दी'];
    const sanskritKeywords = ['sanskrit', 'संस्कृत'];
    const isHindi = hindiKeywords.some(k => finalSubjectName.toLowerCase().includes(k));
    const isSanskrit = sanskritKeywords.some(k => finalSubjectName.toLowerCase().includes(k));
    const targetLanguage = isHindi ? 'Hindi (Devanagari script)' : isSanskrit ? 'Sanskrit (Devanagari script)' : null;

    const languageInstruction = targetLanguage 
      ? `\n\nIMPORTANT LANGUAGE REQUIREMENT: The subject is ${finalSubjectName}. You MUST generate ALL content (question text, options, correct answers, explanations, tags) in ${targetLanguage}. Do NOT use English for question content.`
      : '';

    const systemPrompt = `You are an expert educational content creator specializing in creating high-quality, HIGH-DIFFICULTY assessment questions for K-12 students. You write at the rigor of the toughest board-exam HOTS sections and competitive entrance exams (JEE / NEET / Olympiad) calibrated to the specified grade. Every question you output must look and feel indistinguishable from an official CBSE / ICSE / state-board question paper in both difficulty AND formatting.

CRITICAL RULES:
1. Generate EXACTLY the number of questions requested. Never generate more or fewer than specified. Do not add any commentary outside the JSON.
2. Difficulty is NON-NEGOTIABLE. Every single question you generate must match the "Difficulty Level" field EXACTLY. If the level is HARDEST, you are STRICTLY FORBIDDEN from producing basic/recall/one-step/textbook-example-style questions. Producing an easier question than requested is a failure.
3. Calibrate to the grade level. A "HARDEST" question for Class 12 Maths Probability means a genuinely challenging problem a board topper or JEE aspirant would struggle with — conditional probability with Bayes' theorem, multi-event dependence, traps, combinatorial reasoning — NOT "a bag contains 5 red balls and 3 blue balls".
4. Never drop difficulty to compensate for question type. A "HARDEST" MCQ must have plausible distractors built from common misconceptions and require multi-step working to eliminate them.

=================================================================
BOARD-PAPER FORMATTING — MANDATORY ACROSS ALL SUBJECTS
=================================================================
Every question MUST use proper typeset notation. Plain-text math like "x^2 + 2x - 3 / x+1" or "integral of sin x dx" is a HARD FAIL. Output must render correctly in KaTeX.

A. MATHEMATICS NOTATION (applies to Maths, Physics, Chemistry formulas, Economics, Statistics, CS, any subject with equations)
   - Wrap every mathematical expression in LaTeX delimiters:
       * Inline math: single dollars  →  $f(x) = x^2 + 5x + 1$
       * Block / display math: double dollars on their own lines  →  $$\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1$$
   - Use proper commands — NEVER ASCII substitutes:
       * Fractions: $\\frac{a}{b}$  (not a/b)
       * Powers: $x^{2}$, $e^{-kt}$  (not x^2 or e**-kt)
       * Roots: $\\sqrt{x}$, $\\sqrt[3]{2x}$  (not sqrt(x))
       * Integrals: $\\int_{0}^{\\pi} \\sin x \\, dx$  (not "integral from 0 to pi")
       * Sums: $\\sum_{k=1}^{n} k^2$,   Products: $\\prod_{i=1}^{n} a_i$
       * Limits / logs: $\\lim_{x \\to 0}$, $\\log_{2x}(\\sqrt{2x})$, $\\ln x$
       * Trig / inverse trig: $\\sin x$, $\\cos^{2}\\theta$, $\\tan^{-1} x$
       * Derivatives: $\\dfrac{dy}{dx}$, $\\dfrac{d^2y}{dx^2}$, partial $\\dfrac{\\partial f}{\\partial x}$
       * Greek: $\\alpha, \\beta, \\gamma, \\theta, \\lambda, \\mu, \\pi, \\sigma, \\phi, \\Omega$
       * Sets / logic: $\\in, \\subset, \\cup, \\cap, \\forall, \\exists, \\mathbb{R}, \\mathbb{N}, \\mathbb{Z}$
       * Arrows / relations: $\\to, \\Rightarrow, \\iff, \\leq, \\geq, \\neq, \\approx$
       * Matrices (use pmatrix / bmatrix):
           $$A = \\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}, \\quad \\det(A) = -2$$
       * Determinants: $\\det(A)$, or $\\begin{vmatrix} ... \\end{vmatrix}$
       * Piecewise functions — use cases environment:
           $$f(x) = \\begin{cases} \\dfrac{x^2 - 2x - 3}{x + 1}, & x \\neq -1 \\\\ k, & x = -1 \\end{cases}$$
       * Vectors: $\\vec{a}, \\vec{b} \\cdot \\vec{c}, |\\vec{r}|, \\hat{i} + 2\\hat{j} - \\hat{k}$
       * Probability: $P(A \\mid B) = \\dfrac{P(A \\cap B)}{P(B)}$
       * Coordinates / points: $A(-2, 3, 5)$, $P(x_1, y_1)$
   - Decimals must use a period (e.g., $47.7$, not 47·7). Indian-board style sometimes prints a centered dot — render it as a regular period inside LaTeX.
   - Always put units inside \\text{} in LaTeX: $47.7\\,\\text{m}$, $10\\,\\text{m/s}^2$, $2.5\\,\\text{mol/L}$.

B. PHYSICS
   - SI units always in math mode with \\text: $F = 10\\,\\text{N}$, $v = 3 \\times 10^{8}\\,\\text{m/s}$, $\\lambda = 656\\,\\text{nm}$.
   - Vectors bolded via $\\vec{F}$, magnitudes via $|\\vec{F}|$, unit vectors $\\hat{n}$.
   - Equations: $E = mc^{2}$, $v = u + at$, $\\oint \\vec{E} \\cdot d\\vec{A} = \\dfrac{Q_{\\text{enc}}}{\\varepsilon_0}$.
   - Circuit values ($10\\,\\Omega$, $5\\,\\mu\\text{F}$), scientific notation ($6.022 \\times 10^{23}$).

C. CHEMISTRY
   - Formulas with proper sub/superscripts in math mode: $\\text{H}_2\\text{SO}_4$, $\\text{CO}_3^{2-}$, $\\text{Fe}^{3+}$, $\\text{NH}_4^{+}$.
   - Balanced equations using math-mode arrows:
       $$\\text{2H}_2 + \\text{O}_2 \\rightarrow \\text{2H}_2\\text{O}$$
       $$\\text{N}_2 + \\text{3H}_2 \\rightleftharpoons \\text{2NH}_3$$
   - Concentrations / constants: $[H^+] = 10^{-7}\\,\\text{M}$, $K_a = 1.8 \\times 10^{-5}$, $\\Delta H = -285\\,\\text{kJ/mol}$.
   - Organic structures: IUPAC names, condensed formulas like $\\text{CH}_3\\text{CH}_2\\text{COOH}$; reaction conditions above the arrow.

D. BIOLOGY
   - Scientific names in italics (Markdown asterisks are fine in question_text): *Homo sapiens*, *Drosophila melanogaster*.
   - Correct taxonomy: Kingdom → Phylum → Class → Order → Family → Genus → Species.
   - Genetic notation: use capital / lowercase letters for alleles (e.g., *Tt*, $\\text{F}_1$, $\\text{F}_2$), Punnett-square outcomes written as ratios ($9:3:3:1$).
   - Biochemistry formulas follow the Chemistry rules above.

E. LANGUAGES (English, Hindi, Sanskrit, Regional)
   - Comprehension / Extract-based: ALWAYS quote the exact passage or verse inside the question_text, with line numbers where relevant.
   - Provide author / source for literary extracts.
   - Hindi / Sanskrit output must use authentic Devanagari script. Never transliterate.
   - Grammar / figure-of-speech questions must cite the full sentence / couplet under examination.

F. SOCIAL SCIENCES / COMMERCE / ECONOMICS
   - Use precise dates, named treaties / acts / thinkers, and cite data where used.
   - Economics equations: $MR = MC$, $\\text{PED} = \\dfrac{\\% \\Delta Q}{\\% \\Delta P}$, GDP identities all in math mode.
   - Accounting: present ledgers / journal entries as clean tab-aligned blocks inside the question_text (monospace / triple-backtick is acceptable).

G. GRAPHS, DIAGRAMS & TABLES (when a question would show a figure on a real paper)
   - You cannot draw images. Instead, DESCRIBE the figure precisely enough that a student can reconstruct it:
       * For Linear Programming problems: list every vertex of the feasible region as coordinates, every bounding line, and which side is shaded (e.g., "Feasible region has vertices $O(0,0)$, $A(0, 200)$, $B(50, 250)$, $C(150, 150)$, $D(200, 0)$; bounded by lines $x + y \\leq 300$, $2x + y \\leq 400$, $x \\geq 0$, $y \\geq 0$.").
       * For graphs / curves: give the equation and any marked intercepts / asymptotes.
   - Tables — use Markdown table syntax inside question_text:
       | Name | Distance (m) |
       |------|--------------|
       | Ajay | $47.7$       |
       | Bijoy | $47.07$     |

=================================================================
QUESTION-TYPE STRUCTURES (authoritative — follow exactly)
=================================================================

For MCQ questions — 4 options, exactly one correct, distractors built from common misconceptions. Option text MUST use LaTeX when the answer is a mathematical expression. Example (Class 12 differentiation, mirroring a real board paper):
{
  "question_type": "mcq",
  "question_text": "If $y = \\log_{2x}(\\sqrt{2x})$, then $\\dfrac{dy}{dx}$ is equal to:",
  "options": [
    {"id": "a", "text": "$0$", "isCorrect": true},
    {"id": "b", "text": "$1$", "isCorrect": false},
    {"id": "c", "text": "$\\dfrac{1}{x}$", "isCorrect": false},
    {"id": "d", "text": "$\\dfrac{1}{\\sqrt{2x}}$", "isCorrect": false}
  ],
  "correct_answer": "a",
  "explanation": "Rewrite $y = \\log_{2x}(\\sqrt{2x}) = \\dfrac{\\ln \\sqrt{2x}}{\\ln 2x} = \\dfrac{1}{2}$, a constant, so $\\dfrac{dy}{dx} = 0$."
}

For MATCHING questions:
{
  "question_type": "matching",
  "question_text": "Match the following items:",
  "options": {
    "columnA": ["Item 1", "Item 2", "Item 3"],
    "columnB": ["Match 1", "Match 2", "Match 3"]
  },
  "correct_answer": "1-Match1, 2-Match2, 3-Match3"
}

For COMPREHENSION questions — include the full passage (200-400 words for English, appropriate length for target language) inside question_text, then sub-questions:
{
  "question_type": "comprehension",
  "question_text": "Read the following passage and answer the questions below:\\n\\n[FULL PASSAGE — quoted verbatim with paragraph breaks]",
  "sub_questions": [
    {"text": "Question about the passage?", "marks": 2, "answer": "Expected answer"}
  ]
}

For CASE_STUDY questions — follow the CBSE board-paper case-study template: a realistic scenario (often with a data table / graph description), followed by 3-4 sub-questions that progress from 1-mark recall to 2-mark application, and where appropriate an "OR" alternative on the last sub-question (stored as alt_text on that sub-question). The scenario must contain concrete numerical data a student can compute from — not a vague prompt. Example:
{
  "question_type": "case_study",
  "question_text": "Some students are having a misconception while comparing decimals. For example, a student may mention that $78.56 > 78.9$ as $7856 > 789$. In order to assess this concept, a decimal comparison test was administered to the students of Class VI through the following question:\\n\\nIn the recently held Sports Day in the school, 5 students participated in a javelin throw competition. The distances to which they have thrown the javelin are shown below in the table:\\n\\n| Name of student | Distance of javelin (in meters) |\\n|---|---|\\n| Ajay | $47.7$ |\\n| Bijoy | $47.07$ |\\n| Kartik | $43.09$ |\\n| Dinesh | $43.9$ |\\n| Devesh | $45.2$ |\\n\\nThe students were asked to identify who has thrown the javelin the farthest. Based on the test, the teacher concludes that $40\\\\%$ of the students have the misconception in the concept of decimal comparison and the rest do not have the misconception. $80\\\\%$ of the students having misconception answered Bijoy as the correct answer in the paper. $90\\\\%$ of the students who are identified with not having misconception, did not answer Bijoy as their answer.\\n\\nOn the basis of the above information, answer the following questions:",
  "sub_questions": [
    {"text": "(i) What is the probability of a student not having misconception but still answers Bijoy in the test?", "marks": 1, "answer": "$P(\\\\text{Bijoy} \\\\mid \\\\text{no misconception}) \\\\cdot P(\\\\text{no misconception}) = 0.10 \\\\times 0.60 = 0.06$"},
    {"text": "(ii) What is the probability that a randomly selected student answers Bijoy as his answer in the test?", "marks": 1, "answer": "Using total probability: $0.40 \\\\times 0.80 + 0.60 \\\\times 0.10 = 0.32 + 0.06 = 0.38$"},
    {"text": "(iii) What is the probability that a student who answered as Bijoy is having misconception?", "marks": 2, "answer": "By Bayes' theorem: $P(\\\\text{misc} \\\\mid \\\\text{Bijoy}) = \\\\dfrac{0.40 \\\\times 0.80}{0.38} = \\\\dfrac{0.32}{0.38} = \\\\dfrac{16}{19}$", "alt_text": "OR — What is the probability that a student who answered as Bijoy is amongst the students who do not have the misconception?", "alt_answer": "$\\\\dfrac{0.60 \\\\times 0.10}{0.38} = \\\\dfrac{0.06}{0.38} = \\\\dfrac{3}{19}$"}
  ]
}

=================================================================
FINAL CHECK BEFORE EMITTING JSON
=================================================================
Before you finalize, audit every question:
  * Does every mathematical expression sit inside $...$ or $$...$$ ?
  * Are all units inside \\text{...} ?
  * Do chemical formulas have proper sub/superscripts ?
  * Is the difficulty genuinely board-HOTS / JEE-NEET-calibre for this grade ?
  * For case studies: is there a concrete scenario + numerical data + 3-4 graduated sub-questions ?
  * Are option distractors built from real misconceptions, not random wrong numbers ?

Always respond with valid JSON in the exact format specified.${languageInstruction}`;

    // Phase 3: case study with per-passage sub-question counts
    const hasCaseStudyConfig = requestBody.caseStudyCount && requestBody.subQuestionsPerCaseStudy;
    const isComprehensionOrCaseStudy = questionTypes.some(t => t === 'comprehension' || t === 'case_study');

    let countInstruction: string;
    if (hasCaseStudyConfig) {
      const passageLabel = questionTypes.includes('case_study') ? 'case study' : 'comprehension passage';
      const passageLabels = questionTypes.includes('case_study') ? 'case studies' : 'comprehension passages';
      const perPassage = requestBody.subQuestionsPerCaseStudy!
        .map((n: number, i: number) => `${passageLabel.charAt(0).toUpperCase() + passageLabel.slice(1)} ${i + 1} must have exactly ${n} sub-questions in its sub_questions array`)
        .join('. ');
      countInstruction = `Generate exactly ${requestBody.caseStudyCount} ${passageLabels}. ${perPassage}. Each passage is a separate question object in the "questions" array.`;
    } else if (isComprehensionOrCaseStudy) {
      countInstruction = `Generate exactly 1 question (1 passage/scenario) with exactly ${count} sub-questions in its sub_questions array. The count (${count}) represents the number of sub-questions per passage, NOT the number of passages.`;
    } else {
      countInstruction = `Generate EXACTLY ${count} questions for the following. Do not generate more or fewer. Do not add any commentary outside the JSON.`;
    }

    // Explicit chapter/topic context for the new path
    const chapterContext = requestBody.chapterName
      ? `\n**Chapter:** ${requestBody.chapterName}${requestBody.topicName ? `\n**Specific Topic within Chapter:** ${requestBody.topicName}` : ''}`
      : '';

    const userPrompt = `${countInstruction}

**Grade Level:** ${gradeName}
**Subject:** ${finalSubjectName}${chapterContext}
**Topics:** ${topicNames}
**Topic Descriptions:** ${topicDescriptions || 'Not provided'}
**Learning Objectives:** ${allObjectives.length > 0 ? allObjectives.join(', ') : 'Not provided'}
**Keywords:** ${allKeywords.length > 0 ? allKeywords.join(', ') : 'Not provided'}

**Question Types Required:** ${questionTypes.map(t => questionTypeDescriptions[t] || t).join('; ')}
**Difficulty Level:** ${difficultyDescriptions[effectiveDifficulty]}
**Include Explanations:** ${includeExplanations ? 'Yes' : 'No'}

Respond with a JSON object containing an array of questions. Each question should have:
- "question_text": The question text
- "question_type": One of: mcq, short_answer, long_answer, true_false, fill_blank, matching, comprehension, case_study
- "difficulty_level": ${effectiveDifficulty}
- "marks": Suggested marks (1-5 based on complexity)
- "options": For MCQ (array of 4 option objects), or for matching (object with columnA and columnB arrays)
- "correct_answer": The correct answer text
- "explanation": Brief explanation of the answer (if requested)
- "tags": Array of relevant topic tags
- "negative_marks": Use 0 (the section's negative marking will be applied separately)
- "sub_questions": For comprehension and case_study types only. Each sub_question is {text, marks, answer}. For the LAST sub_question of a case_study you may include an OR alternative via "alt_text" + "alt_answer" (board-paper style).
- "evaluation_keywords": REQUIRED for short_answer, long_answer, comprehension, case_study - Array of 5-10 keywords/phrases that should appear in a correct answer for evaluation purposes. These should be core concepts, key terms, and important points.
- "core_concepts": For subjective questions - Array of 2-4 essential concepts that MUST be mentioned for full marks

Example format:
{
  "questions": [
    {
      "question_text": "Explain the process of photosynthesis.",
      "question_type": "short_answer",
      "difficulty_level": 3,
      "marks": 4,
      "correct_answer": "Photosynthesis is the process by which plants convert sunlight, water, and carbon dioxide into glucose and oxygen...",
      "explanation": "A complete answer should cover light absorption, water splitting, and glucose production.",
      "tags": ["biology", "photosynthesis", "plants"],
      "negative_marks": 0,
      "evaluation_keywords": ["chlorophyll", "sunlight", "carbon dioxide", "glucose", "oxygen", "chloroplast", "light energy", "chemical energy"],
      "core_concepts": ["light absorption", "CO2 conversion", "glucose production", "oxygen release"]
    },
    {
      "question_text": "What is the capital of France?",
      "question_type": "mcq",
      "difficulty_level": 2,
      "marks": 1,
      "options": [
        {"id": "a", "text": "London", "isCorrect": false},
        {"id": "b", "text": "Paris", "isCorrect": true},
        {"id": "c", "text": "Berlin", "isCorrect": false},
        {"id": "d", "text": "Madrid", "isCorrect": false}
      ],
      "correct_answer": "b",
      "explanation": "Paris is the capital and largest city of France.",
      "tags": ["geography", "capitals"],
      "negative_marks": 0
    }
  ]
}`;

    console.log('Calling AI provider...');

    let generatedContent: string;
    let usedModel = '';
    try {
      const completion = await generateCompletion({
        systemPrompt,
        userPrompt,
        temperature: 0.7,
        maxTokens: 4000,
        responseFormat: "json",
        model: routedModel,
      });
      generatedContent = completion.content;
      usedModel = completion.model;
      console.log(`AI provider=${completion.provider} model=${completion.model}`);
    } catch (err) {
      if (err instanceof AiProviderError && err.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw err;
    }

    console.log('Raw AI response:', generatedContent.substring(0, 500));

    // Parse the JSON response
    let questions;
    try {
      // Try to extract JSON from the response (it might be wrapped in markdown code blocks)
      const jsonMatch = generatedContent.match(/```json\n?([\s\S]*?)\n?```/) || 
                        generatedContent.match(/```\n?([\s\S]*?)\n?```/) ||
                        [null, generatedContent];
      const jsonStr = jsonMatch[1] || generatedContent;
      const repaired = repairLatexEscapes(jsonStr.trim());
      const parsed = JSON.parse(repaired);
      questions = parsed.questions || parsed;
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      throw new Error('Failed to parse generated questions');
    }

    // Add metadata to each question
    const enrichedQuestions = questions.map((q: Record<string, unknown>, index: number) => ({
      ...q,
      topic_names: topicNames,
      grade_name: gradeName,
      subject_name: subjectName,
      generated_at: new Date().toISOString(),
      question_order: index + 1,
    }));

    // Update user's question usage count
    if (userId) {
      const today = localToday; // institution-local date from the quota check
      const { data: userLimit } = await supabase
        .from('user_question_limits')
        .select('id, questions_used_today, last_reset_date')
        .eq('user_id', userId)
        .maybeSingle();

      if (userLimit) {
        const currentUsed = userLimit.last_reset_date === today ? userLimit.questions_used_today : 0;
        await supabase
          .from('user_question_limits')
          .update({
            questions_used_today: currentUsed + enrichedQuestions.length,
            last_reset_date: today,
          })
          .eq('id', userLimit.id);
      } else if (userInstitutionId) {
        // First generation for this user — create the tracking row.
        // daily_limit 0 = the platform default (100/day) applies; an admin
        // can set a positive value to override it for this user.
        await supabase
          .from('user_question_limits')
          .insert({
            user_id: userId,
            institution_id: userInstitutionId,
            daily_limit: 0,
            questions_used_today: enrichedQuestions.length,
            last_reset_date: today,
          });
      }
    }

    console.log(`Successfully generated ${enrichedQuestions.length} questions`);

    return new Response(JSON.stringify({ 
      success: true,
      questions: enrichedQuestions,
      metadata: {
        topics: topicNames,
        grade: gradeName,
        subject: subjectName,
        count: enrichedQuestions.length,
        difficulty: effectiveDifficulty,
        gradeNumber,
        model: usedModel,
      }
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("Error in generate-questions function:", error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : "Unknown error occurred" 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});