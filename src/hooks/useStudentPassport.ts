import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StudentPassport {
  id: string;
  student_id: string;
  institution_id: string;
  total_exams_taken: number;
  total_exams_passed: number;
  average_percentage: number;
  highest_percentage: number;
  total_study_hours: number;
  login_streak_current: number;
  login_streak_max: number;
  total_badges_earned: number;
  total_points: number;
  rank_in_class: number | null;
  rank_in_institution: number | null;
  subjects_mastered: string[];
  improvement_rate: number;
  last_active_at: string | null;
  passport_level: string;
  created_at: string;
  updated_at: string;
}

export interface AcademicRecord {
  id: string;
  student_id: string;
  institution_id: string;
  academic_year: string;
  class_name: string;
  section_name: string | null;
  class_id: string | null;
  total_exams: number;
  exams_passed: number;
  average_percentage: number;
  highest_percentage: number;
  total_points_earned: number;
  badges_earned: number;
  rank_in_class: number | null;
  rank_in_institution: number | null;
  remarks: string | null;
  created_at: string;
  updated_at: string;
}

export interface SubjectCapability {
  id: string;
  student_id: string;
  institution_id: string;
  subject_id: string;
  subject_name: string;
  total_exams: number;
  total_questions: number;
  correct_answers: number;
  accuracy_percent: number;
  mastery_level: number;
  capability_tier: CapabilityTier;
  strongest_topics: string[];
  weakest_topics: string[];
  year_wise_data: YearWiseEntry[];
  last_exam_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface YearWiseEntry {
  year: string;
  exams: number;
  accuracy: number;
  mastery: number;
  class_name: string;
}

export type CapabilityTier = 'developing' | 'competent' | 'proficient' | 'expert';
export type PassportLevel = 'beginner' | 'intermediate' | 'advanced' | 'expert' | 'master';

export interface PassportData {
  passport: StudentPassport | null;
  academicRecords: AcademicRecord[];
  subjectCapabilities: SubjectCapability[];
}

export function useStudentPassport(studentId?: string) {
  return useQuery({
    queryKey: ["student-passport", studentId],
    queryFn: async (): Promise<PassportData | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      const targetStudentId = studentId || user?.id;
      if (!targetStudentId) return null;

      // Fetch passport, academic records, and subject capabilities in parallel
      const [passportResult, academicResult, capabilitiesResult] = await Promise.all([
        fetchOrComputePassport(targetStudentId),
        supabase
          .from("passport_academic_records")
          .select("*")
          .eq("student_id", targetStudentId)
          .order("academic_year", { ascending: false }),
        supabase
          .from("passport_subject_capabilities")
          .select("*")
          .eq("student_id", targetStudentId)
          .order("mastery_level", { ascending: false }),
      ]);

      const academicRecords = (academicResult.data || []) as AcademicRecord[];
      let subjectCapabilities = (capabilitiesResult.data || []).map(c => ({
        ...c,
        capability_tier: c.capability_tier as CapabilityTier,
        year_wise_data: (c.year_wise_data || []) as unknown as YearWiseEntry[],
      })) as SubjectCapability[];

      // If no persisted capabilities, compute on-the-fly
      if (subjectCapabilities.length === 0 && passportResult) {
        subjectCapabilities = await computeSubjectCapabilities(targetStudentId, passportResult.institution_id);
      }

      return {
        passport: passportResult,
        academicRecords,
        subjectCapabilities,
      };
    },
  });
}

async function fetchOrComputePassport(studentId: string): Promise<StudentPassport | null> {
  const { data: passport, error } = await supabase
    .from("student_passport")
    .select("*")
    .eq("student_id", studentId)
    .maybeSingle();

  if (error) throw error;
  if (passport) return passport as StudentPassport;

  return computePassportData(studentId);
}

async function computeSubjectCapabilities(studentId: string, institutionId: string): Promise<SubjectCapability[]> {
  // Get concept mastery grouped by subject
  const { data: mastery } = await supabase
    .from("concept_mastery")
    .select(`
      subject_id,
      total_questions_attempted,
      total_questions_correct,
      mastery_level,
      topic:syllabus_topics(name:topic_name),
      subject:subjects(name)
    `)
    .eq("student_id", studentId);

  if (!mastery || mastery.length === 0) return [];

  // Group by subject
  const subjectMap = new Map<string, {
    subject_id: string;
    subject_name: string;
    totalQuestions: number;
    correctAnswers: number;
    masterySum: number;
    topicCount: number;
    topics: { name: string; mastery: number }[];
  }>();

  // PostgREST to-one embeds — narrow inline instead of `any` (§5a)
  type NameJoin = { name: string | null } | null;
  for (const m of mastery) {
    const subjectName = (m.subject as NameJoin)?.name || 'Unknown';
    const topicName = (m.topic as NameJoin)?.name || 'Unknown';
    
    if (!subjectMap.has(m.subject_id)) {
      subjectMap.set(m.subject_id, {
        subject_id: m.subject_id,
        subject_name: subjectName,
        totalQuestions: 0,
        correctAnswers: 0,
        masterySum: 0,
        topicCount: 0,
        topics: [],
      });
    }

    const entry = subjectMap.get(m.subject_id)!;
    entry.totalQuestions += m.total_questions_attempted || 0;
    entry.correctAnswers += m.total_questions_correct || 0;
    entry.masterySum += m.mastery_level || 0;
    entry.topicCount += 1;
    entry.topics.push({ name: topicName, mastery: m.mastery_level || 0 });
  }

  const capabilities: SubjectCapability[] = [];
  for (const [, entry] of subjectMap) {
    const accuracy = entry.totalQuestions > 0 ? (entry.correctAnswers / entry.totalQuestions) * 100 : 0;
    const avgMastery = entry.topicCount > 0 ? Math.round(entry.masterySum / entry.topicCount) : 0;

    // Sort topics by mastery
    const sorted = [...entry.topics].sort((a, b) => b.mastery - a.mastery);
    const strongest = sorted.slice(0, 3).map(t => t.name);
    const weakest = sorted.slice(-3).reverse().map(t => t.name);

    capabilities.push({
      id: '',
      student_id: studentId,
      institution_id: institutionId,
      subject_id: entry.subject_id,
      subject_name: entry.subject_name,
      total_exams: 0,
      total_questions: entry.totalQuestions,
      correct_answers: entry.correctAnswers,
      accuracy_percent: Math.round(accuracy * 10) / 10,
      mastery_level: avgMastery,
      capability_tier: getCapabilityTier(accuracy),
      strongest_topics: strongest,
      weakest_topics: weakest,
      year_wise_data: [],
      last_exam_date: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  return capabilities.sort((a, b) => b.mastery_level - a.mastery_level);
}

export function getCapabilityTier(accuracy: number): CapabilityTier {
  if (accuracy >= 85) return 'expert';
  if (accuracy >= 65) return 'proficient';
  if (accuracy >= 40) return 'competent';
  return 'developing';
}

export function getCapabilityTierConfig(tier: CapabilityTier) {
  const configs = {
    developing: {
      label: 'Developing',
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-100 dark:bg-orange-900/30',
      borderColor: 'border-orange-300 dark:border-orange-600',
      icon: '🌱',
      progressColor: 'bg-orange-500',
    },
    competent: {
      label: 'Competent',
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      borderColor: 'border-blue-300 dark:border-blue-600',
      icon: '📘',
      progressColor: 'bg-blue-500',
    },
    proficient: {
      label: 'Proficient',
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-100 dark:bg-green-900/30',
      borderColor: 'border-green-300 dark:border-green-600',
      icon: '⭐',
      progressColor: 'bg-green-500',
    },
    expert: {
      label: 'Expert',
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      borderColor: 'border-purple-300 dark:border-purple-600',
      icon: '🏆',
      progressColor: 'bg-purple-500',
    },
  };
  return configs[tier] || configs.developing;
}

async function computePassportData(studentId: string): Promise<StudentPassport | null> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("institution_id")
    .eq("id", studentId)
    .single();

  if (!profile?.institution_id) return null;

  const { data: attempts } = await supabase
    .from("student_exam_attempts")
    .select(`
      id,
      is_submitted,
      final_results(
        is_pass,
        percentage,
        is_published
      )
    `)
    .eq("student_id", studentId)
    .eq("is_submitted", true);

  type FinalResultJoin = {
    total_marks_obtained: number | null;
    total_max_marks: number | null;
    is_pass: boolean | null;
    percentage: number | null;
    is_published: boolean | null;
  } | null;
  const submittedAttempts = attempts || [];
  const publishedResults = submittedAttempts
    .filter(a => a.final_results && (a.final_results as unknown as FinalResultJoin)?.is_published)
    .map(a => a.final_results as unknown as FinalResultJoin);

  const totalExamsTaken = submittedAttempts.length;
  const totalExamsPassed = publishedResults.filter(r => r?.is_pass).length;
  const percentages = publishedResults.map(r => r?.percentage || 0).filter(p => p > 0);
  const averagePercentage = percentages.length > 0 
    ? percentages.reduce((a, b) => a + b, 0) / percentages.length 
    : 0;
  const highestPercentage = percentages.length > 0 ? Math.max(...percentages) : 0;

  const { count: badgesCount } = await supabase
    .from("user_badges")
    .select("id", { count: "exact" })
    .eq("user_id", studentId);

  const { data: badges } = await supabase
    .from("user_badges")
    .select("badge:badge_definitions(points)")
    .eq("user_id", studentId);

  const totalPoints = badges?.reduce(
    (sum, b) => sum + ((b.badge as { points: number | null } | null)?.points || 0),
    0,
  ) || 0;
  const passportLevel = calculatePassportLevel(totalPoints, totalExamsTaken, averagePercentage);

  return {
    id: '',
    student_id: studentId,
    institution_id: profile.institution_id,
    total_exams_taken: totalExamsTaken,
    total_exams_passed: totalExamsPassed,
    average_percentage: averagePercentage,
    highest_percentage: highestPercentage,
    total_study_hours: 0,
    login_streak_current: 0,
    login_streak_max: 0,
    total_badges_earned: badgesCount || 0,
    total_points: totalPoints,
    rank_in_class: null,
    rank_in_institution: null,
    subjects_mastered: [],
    improvement_rate: 0,
    last_active_at: null,
    passport_level: passportLevel,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function calculatePassportLevel(points: number, exams: number, avgPercentage: number): PassportLevel {
  const score = points + (exams * 10) + (avgPercentage * 2);
  if (score >= 1000) return 'master';
  if (score >= 500) return 'expert';
  if (score >= 200) return 'advanced';
  if (score >= 50) return 'intermediate';
  return 'beginner';
}

export function getPassportLevelConfig(level: PassportLevel) {
  const configs = {
    beginner: {
      label: 'Beginner',
      color: 'text-slate-600 dark:text-slate-400',
      bgColor: 'bg-slate-100 dark:bg-slate-800',
      borderColor: 'border-slate-300 dark:border-slate-600',
      icon: '🌱',
      minPoints: 0,
      maxPoints: 49,
    },
    intermediate: {
      label: 'Intermediate',
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-100 dark:bg-blue-900/30',
      borderColor: 'border-blue-300 dark:border-blue-600',
      icon: '📚',
      minPoints: 50,
      maxPoints: 199,
    },
    advanced: {
      label: 'Advanced',
      color: 'text-amber-600 dark:text-amber-400',
      bgColor: 'bg-amber-100 dark:bg-amber-900/30',
      borderColor: 'border-amber-300 dark:border-amber-600',
      icon: '⭐',
      minPoints: 200,
      maxPoints: 499,
    },
    expert: {
      label: 'Expert',
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-100 dark:bg-purple-900/30',
      borderColor: 'border-purple-300 dark:border-purple-600',
      icon: '🏆',
      minPoints: 500,
      maxPoints: 999,
    },
    master: {
      label: 'Master',
      color: 'text-yellow-600 dark:text-yellow-400',
      bgColor: 'bg-gradient-to-r from-yellow-100 to-amber-100 dark:from-yellow-900/30 dark:to-amber-900/30',
      borderColor: 'border-yellow-400 dark:border-yellow-600',
      icon: '👑',
      minPoints: 1000,
      maxPoints: Infinity,
    },
  };
  return configs[level] || configs.beginner;
}
