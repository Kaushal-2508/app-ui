/**
 * Auto-grading utility for objective questions
 * Handles MCQ, True/False, Fill in Blank, and keyword-based subjective evaluation
 */

export interface AutoGradeResult {
  isCorrect: boolean;
  marksAwarded: number;
  maxMarks: number;
  feedback: string;
  matchedAnswer?: string;
  keywordsMatched?: string[];
  keywordsMissed?: string[];
  confidenceScore?: number;
}

export interface KeywordEvaluationConfig {
  keywords: string[];
  coreConcepts?: string[];
  maxMarks: number;
  partialMarkingAllowed?: boolean;
  minKeywordsForFullMarks?: number;
}

/**
 * Auto-grade an objective question
 * Returns null for subjective questions that need manual review
 */
export function autoGradeQuestion(
  questionType: string,
  studentAnswer: string | Record<string, unknown> | null | undefined,
  correctAnswer: string | null,
  options: Record<string, unknown> | null,
  maxMarks: number,
  negativeMarks: number = 0
): AutoGradeResult | null {
  // Can't grade without a correct answer
  if (!correctAnswer) return null;

  // Normalize student answer
  const normalizedStudentAnswer = normalizeAnswer(studentAnswer);
  
  switch (questionType) {
    case "mcq": {
      // Handle MCQ - compare selected option to correct answer
      const isCorrect = compareMCQAnswer(normalizedStudentAnswer, correctAnswer, options);
      return {
        isCorrect,
        marksAwarded: isCorrect ? maxMarks : (negativeMarks > 0 ? -negativeMarks : 0),
        maxMarks,
        feedback: isCorrect 
          ? "✓ Correct answer!" 
          : `✗ Incorrect. The correct answer was: ${formatCorrectAnswer(correctAnswer, options)}`,
        matchedAnswer: normalizedStudentAnswer,
      };
    }

    case "true_false": {
      // Compare boolean or "true"/"false" string
      const studentBool = normalizedStudentAnswer?.toLowerCase();
      const correctBool = correctAnswer.toLowerCase();
      const isCorrect = studentBool === correctBool || 
                        (studentBool === "t" && correctBool === "true") ||
                        (studentBool === "f" && correctBool === "false");
      return {
        isCorrect,
        marksAwarded: isCorrect ? maxMarks : (negativeMarks > 0 ? -negativeMarks : 0),
        maxMarks,
        feedback: isCorrect 
          ? "✓ Correct!" 
          : `✗ Incorrect. The answer was: ${correctAnswer}`,
        matchedAnswer: normalizedStudentAnswer,
      };
    }

    case "fill_blank": {
      // Case-insensitive comparison with basic fuzzy matching
      const isCorrect = compareFillBlankAnswer(normalizedStudentAnswer, correctAnswer);
      return {
        isCorrect,
        marksAwarded: isCorrect ? maxMarks : 0,
        maxMarks,
        feedback: isCorrect 
          ? "✓ Correct!" 
          : `✗ The expected answer was: ${correctAnswer}`,
        matchedAnswer: normalizedStudentAnswer,
      };
    }

    default:
      // Subjective questions - return null, needs manual/AI evaluation
      return null;
  }
}

/**
 * Keyword-based evaluation for subjective questions (Feature 27)
 * This evaluates short answer, long answer, case study, and comprehension questions
 * based on the presence of keywords and core concepts.
 */
export function evaluateWithKeywords(
  studentAnswer: string,
  config: KeywordEvaluationConfig
): AutoGradeResult {
  const { 
    keywords, 
    coreConcepts = [], 
    maxMarks, 
    partialMarkingAllowed = true,
    minKeywordsForFullMarks 
  } = config;

  if (!studentAnswer || studentAnswer.trim().length === 0) {
    return {
      isCorrect: false,
      marksAwarded: 0,
      maxMarks,
      feedback: "No answer provided.",
      keywordsMatched: [],
      keywordsMissed: keywords,
      confidenceScore: 0,
    };
  }

  const answerLower = studentAnswer.toLowerCase();
  
  // Check for keyword matches
  const allKeywords = [...new Set([...keywords, ...coreConcepts])];
  const matchedKeywords: string[] = [];
  const missedKeywords: string[] = [];

  for (const keyword of allKeywords) {
    const keywordLower = keyword.toLowerCase().trim();
    // Check for exact word match or partial match (for compound words)
    const wordBoundaryRegex = new RegExp(`\\b${escapeRegex(keywordLower)}\\b`, 'i');
    const partialMatch = answerLower.includes(keywordLower);
    
    if (wordBoundaryRegex.test(answerLower) || partialMatch) {
      matchedKeywords.push(keyword);
    } else {
      missedKeywords.push(keyword);
    }
  }

  // Calculate marks based on keyword coverage
  const totalKeywords = allKeywords.length;
  const matchedCount = matchedKeywords.length;
  const matchRatio = totalKeywords > 0 ? matchedCount / totalKeywords : 0;
  
  // Determine if full marks should be awarded
  const requiredForFull = minKeywordsForFullMarks || Math.ceil(totalKeywords * 0.8);
  const isFullMarks = matchedCount >= requiredForFull;
  
  let marksAwarded: number;
  if (isFullMarks) {
    marksAwarded = maxMarks;
  } else if (partialMarkingAllowed) {
    // Award partial marks based on keyword coverage
    marksAwarded = Math.round(maxMarks * matchRatio * 100) / 100;
  } else {
    // No partial marking - need all keywords for any marks
    marksAwarded = 0;
  }

  // Calculate confidence score (0-1)
  const confidenceScore = matchRatio;
  
  // Generate feedback
  let feedback: string;
  if (matchedCount === totalKeywords) {
    feedback = `✓ Excellent! All ${totalKeywords} key concepts covered.`;
  } else if (matchedCount > 0) {
    feedback = `Partial marks awarded. ${matchedCount}/${totalKeywords} key concepts identified. `;
    if (missedKeywords.length <= 3) {
      feedback += `Missing: ${missedKeywords.join(", ")}.`;
    } else {
      feedback += `Some key concepts are missing.`;
    }
  } else {
    feedback = "✗ No key concepts found in the answer. Please review the expected answer.";
  }

  return {
    isCorrect: matchedCount === totalKeywords,
    marksAwarded,
    maxMarks,
    feedback,
    keywordsMatched: matchedKeywords,
    keywordsMissed: missedKeywords,
    confidenceScore,
  };
}

/**
 * Escape special regex characters
 */
function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize various answer formats to a string
 */
function normalizeAnswer(answer: string | Record<string, unknown> | null | undefined): string {
  if (!answer) return "";
  
  if (typeof answer === "string") {
    return answer.trim();
  }
  
  // Handle object format (e.g., { selected: "A" } or { value: "answer" })
  if (typeof answer === "object") {
    if ("selected" in answer) return String(answer.selected || "").trim();
    if ("value" in answer) return String(answer.value || "").trim();
    if ("answer" in answer) return String(answer.answer || "").trim();
    // For MCQ, check if it's option index
    const keys = Object.keys(answer);
    if (keys.length === 1 && answer[keys[0]]) {
      return String(answer[keys[0]]).trim();
    }
  }
  
  return "";
}

/**
 * Compare MCQ answer considering various formats
 * correctAnswer might be "A", "0", or the actual option text
 */
function compareMCQAnswer(
  studentAnswer: string,
  correctAnswer: string,
  options: Record<string, unknown> | null
): boolean {
  if (!studentAnswer) return false;
  
  const studentLower = studentAnswer.toLowerCase().trim();
  const correctLower = correctAnswer.toLowerCase().trim();
  
  // Direct match
  if (studentLower === correctLower) return true;
  
  // Check if correct answer is an index (0, 1, 2, 3) and student gave letter (A, B, C, D)
  const optionLetters = ["a", "b", "c", "d", "e", "f"];
  const correctIndex = parseInt(correctAnswer);
  if (!isNaN(correctIndex) && correctIndex >= 0 && correctIndex < optionLetters.length) {
    if (studentLower === optionLetters[correctIndex]) return true;
  }
  
  // Check reverse: student gave index, correct is letter
  const studentIndex = optionLetters.indexOf(studentLower);
  if (studentIndex !== -1 && correctLower === String(studentIndex)) return true;
  
  // Check if options array exists and compare by content
  if (options && Array.isArray(options)) {
    const correctOptionText = options[correctIndex]?.toString().toLowerCase().trim();
    if (correctOptionText && studentLower === correctOptionText) return true;
  }
  
  return false;
}

/**
 * Compare fill in blank answer with fuzzy matching
 */
function compareFillBlankAnswer(studentAnswer: string, correctAnswer: string): boolean {
  if (!studentAnswer) return false;
  
  const studentLower = studentAnswer.toLowerCase().trim();
  const correctLower = correctAnswer.toLowerCase().trim();
  
  // Exact match
  if (studentLower === correctLower) return true;
  
  // Handle multiple correct answers separated by | or ,
  const correctOptions = correctLower.split(/[|,]/).map(s => s.trim());
  if (correctOptions.some(opt => opt === studentLower)) return true;
  
  // Basic fuzzy: remove articles and extra spaces
  const cleanStudent = studentLower.replace(/^(a|an|the)\s+/i, "").replace(/\s+/g, " ");
  const cleanCorrect = correctLower.replace(/^(a|an|the)\s+/i, "").replace(/\s+/g, " ");
  if (cleanStudent === cleanCorrect) return true;
  
  // Plural handling
  if (cleanStudent + "s" === cleanCorrect || cleanStudent === cleanCorrect + "s") return true;
  
  return false;
}

/**
 * Format correct answer for display
 */
function formatCorrectAnswer(
  correctAnswer: string,
  options: Record<string, unknown> | null
): string {
  // If options exist and correct answer is an index, show the option text
  if (options && Array.isArray(options)) {
    const index = parseInt(correctAnswer);
    if (!isNaN(index) && index >= 0 && index < options.length) {
      const letter = String.fromCharCode(65 + index); // A, B, C, D
      return `${letter}. ${options[index]}`;
    }
  }
  return correctAnswer;
}

/**
 * Check if a question type is auto-gradable (objective)
 */
export function isAutoGradable(questionType: string): boolean {
  return ["mcq", "true_false", "fill_blank"].includes(questionType);
}

/**
 * Check if a question type supports keyword-based evaluation
 */
export function supportsKeywordEvaluation(questionType: string): boolean {
  return ["short_answer", "long_answer", "case_study", "comprehension"].includes(questionType);
}

/**
 * Batch auto-grade multiple answers
 */
export function autoGradeBatch(
  answers: Array<{
    questionId: string;
    questionType: string;
    studentAnswer: string | Record<string, unknown> | null | undefined;
    correctAnswer: string | null;
    options: Record<string, unknown> | null;
    maxMarks: number;
    negativeMarks?: number;
  }>
): Map<string, AutoGradeResult | null> {
  const results = new Map<string, AutoGradeResult | null>();
  
  for (const answer of answers) {
    const result = autoGradeQuestion(
      answer.questionType,
      answer.studentAnswer,
      answer.correctAnswer,
      answer.options,
      answer.maxMarks,
      answer.negativeMarks || 0
    );
    results.set(answer.questionId, result);
  }
  
  return results;
}

/**
 * Batch keyword evaluation for subjective answers
 */
export function evaluateSubjectiveBatch(
  answers: Array<{
    questionId: string;
    studentAnswer: string;
    config: KeywordEvaluationConfig;
  }>
): Map<string, AutoGradeResult> {
  const results = new Map<string, AutoGradeResult>();
  
  for (const answer of answers) {
    const result = evaluateWithKeywords(answer.studentAnswer, answer.config);
    results.set(answer.questionId, result);
  }
  
  return results;
}
