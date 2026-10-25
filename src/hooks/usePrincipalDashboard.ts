import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { formatClassName } from "@/lib/utils";
import { getDisplayName } from "@/lib/displayName";

export interface GradeSectionHeatmapItem {
  classId: string;
  grade: string;
  section: string;
  avgPercent: number;
  studentCount: number;
  teacherName?: string;
  subjectName?: string;
}

export interface UnderperformingClass {
  classId: string;
  grade: string;
  section: string;
  subject: string;
  classAvg: number;
  schoolAvg: number;
  gap: number;
  teacherName: string;
  teacherId: string;
}

export interface TeacherPerformanceSummary {
  teacherId: string;
  teacherName: string;
  subject: string;
  classCount: number;
  classAvg: number;
  schoolAvg: number;
  gap: number;
  remark: "Above average" | "At par" | "Below average";
}

export interface SubjectOverview {
  subjectId: string;
  subjectName: string;
  schoolAvg: number;
  topClassAvg: number;
  topClassName: string;
}

export interface ClassDrilldown {
  classId: string;
  grade: string;
  section: string;
  subject: string;
  teacherName: string;
  classAvg: number;
  schoolAvg: number;
  topClassPercent: number;
  scoreDistribution: { range: string; count: number; color: string }[];
  students: {
    studentId: string;
    studentName: string;
    accuracy: number;
    avgTime: number;
    efficiency: number;
    deviation: number;
  }[];
  suggestions: string[];
}

// One live performance row. Source of truth is `student_performance_snapshots`
// (one row per student per evaluated exam). This dashboard USED to read
// `class_aggregates`, but that table has been dead since Feb 2026 — 0 rows for
// virtually every school — which is why every heat-map cell rendered 0% / 0
// students / 0.0% school average. `student_performance_snapshots` is the same
// live source the newer school dashboard (useComprehensivePrincipalAnalytics)
// already reads, so both surfaces now agree on the numbers.
interface SnapshotRow {
  student_id: string;
  class_id: string;
  accuracy_percent: number | null;
}

interface DrilldownSnapshotRow {
  student_id: string;
  accuracy_percent: number | null;
  avg_time_per_question_seconds: number | null;
  efficiency_score: number | null;
  profiles: unknown; // getDisplayName narrows T | T[] internally
}

interface AssignmentSubjectEmbed {
  id: string;
  name: string | null;
}
interface TeacherAssignmentRow {
  class_id: string;
  subject_id: string | null;
  user_id: string;
  profiles: unknown; // getDisplayName narrows T | T[] internally
  subjects: AssignmentSubjectEmbed | AssignmentSubjectEmbed[] | null;
}

function pickOne<T>(v: T | T[] | null | undefined): T | null {
  if (v == null) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

export function usePrincipalOverview(institutionId: string | null) {
  return useQuery({
    queryKey: ["principal-overview", institutionId],
    queryFn: async () => {
      if (!institutionId) return null;

      // Get all active classes for institution
      const { data: classes } = await supabase
        .from("classes")
        .select("id, name, section, academic_year")
        .eq("institution_id", institutionId)
        .eq("is_active", true);

      const classIds = classes?.map(c => c.id) || [];

      // Live performance data. `.range` guards PostgREST's silent 1000-row cap.
      // PERF-DEBT: client-side aggregation of raw snapshots — fine at current
      // per-school volumes, mirror of useComprehensivePrincipalAnalytics; a
      // server-side RPC is the long-term fix (see perf-audit 2026-07-07).
      const { data: snapshotsRaw } = classIds.length > 0
        ? await supabase
            .from("student_performance_snapshots")
            .select("student_id, class_id, accuracy_percent")
            .in("class_id", classIds)
            .range(0, 9999)
        : { data: [] };
      const snapshots = (snapshotsRaw ?? []) as SnapshotRow[];

      // Get teacher assignments with profiles
      const { data: teacherAssignmentsRaw } = await supabase
        .from("class_assignments")
        .select(`
          class_id,
          subject_id,
          user_id,
          profiles:user_id(id, full_name),
          subjects:subject_id(id, name)
        `)
        .in("class_id", classIds)
        .eq("role", "teacher");
      const teacherAssignments = (teacherAssignmentsRaw ?? []) as unknown as TeacherAssignmentRow[];

      // Get all teachers for the institution (headcount only)
      const { data: teachers } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("institution_id", institutionId)
        .eq("role", "teacher");

      // Fold snapshots into per-class accuracy lists + distinct-student sets once.
      const byClass = new Map<string, { acc: number[]; students: Set<string> }>();
      for (const s of snapshots) {
        let entry = byClass.get(s.class_id);
        if (!entry) {
          entry = { acc: [], students: new Set() };
          byClass.set(s.class_id, entry);
        }
        entry.acc.push(Number(s.accuracy_percent) || 0);
        entry.students.add(s.student_id);
      }

      // School average = mean over every snapshot (matches the newer school
      // dashboard so the two surfaces never disagree).
      const schoolAvg = mean(snapshots.map(s => Number(s.accuracy_percent) || 0));

      const assignmentForClass = (classId: string) =>
        teacherAssignments.find(t => t.class_id === classId);

      // Build grade-section heatmap. studentCount is DISTINCT students (a
      // student can have several exam snapshots); avgPercent is the mean over
      // this class's snapshots. Classes with no snapshots keep avgPercent 0 and
      // studentCount 0 — the UI renders those as "No data", not red 0%.
      const heatmapData: GradeSectionHeatmapItem[] = (classes ?? []).map(cls => {
        const entry = byClass.get(cls.id);
        const teacher = assignmentForClass(cls.id);
        return {
          classId: cls.id,
          grade: cls.name,
          section: cls.section || "A",
          avgPercent: entry ? mean(entry.acc) : 0,
          studentCount: entry ? entry.students.size : 0,
          teacherName: teacher ? getDisplayName(teacher.profiles, "Unassigned") : "Unassigned",
        };
      });

      // Underperforming classes — ONLY those that actually have data. A class
      // with no exams yet is "no data", not a 0% failure (this was the flood of
      // false red rows when the source table was empty).
      const underperformingClasses: UnderperformingClass[] = heatmapData
        .filter(h => h.studentCount > 0 && (h.avgPercent < (schoolAvg - 10) || h.avgPercent < 50))
        .map(h => {
          const teacher = assignmentForClass(h.classId);
          return {
            classId: h.classId,
            grade: h.grade,
            section: h.section,
            subject: pickOne(teacher?.subjects ?? null)?.name || "General",
            classAvg: h.avgPercent,
            schoolAvg,
            gap: schoolAvg - h.avgPercent,
            teacherName: h.teacherName || "Unassigned",
            teacherId: teacher?.user_id || "",
          };
        })
        .sort((a, b) => b.gap - a.gap);

      // Teacher performance — mean accuracy across all their classes' snapshots.
      const teacherMap = new Map<string, {
        teacherId: string;
        teacherName: string;
        subjects: Set<string>;
        classIds: Set<string>;
        acc: number[];
      }>();
      for (const ta of teacherAssignments) {
        let entry = teacherMap.get(ta.user_id);
        if (!entry) {
          entry = {
            teacherId: ta.user_id,
            teacherName: getDisplayName(ta.profiles),
            subjects: new Set(),
            classIds: new Set(),
            acc: [],
          };
          teacherMap.set(ta.user_id, entry);
        }
        entry.subjects.add(pickOne(ta.subjects)?.name || "General");
        // Guard against double-counting a class the teacher holds for >1 subject.
        if (!entry.classIds.has(ta.class_id)) {
          entry.classIds.add(ta.class_id);
          const cs = byClass.get(ta.class_id);
          if (cs) entry.acc.push(...cs.acc);
        }
      }

      const teacherPerformance: TeacherPerformanceSummary[] = Array.from(teacherMap.values())
        // Exclude teachers whose classes have no evaluated exams yet — otherwise
        // classAvg=0 renders them as a red "0.0% / Below average", the same
        // false-failure this fix removes from the heatmap and underperformers.
        .filter(tp => tp.acc.length > 0)
        .map(tp => {
          const classAvg = mean(tp.acc);
          const gap = classAvg - schoolAvg;
          let remark: "Above average" | "At par" | "Below average" = "At par";
          if (gap > 5) remark = "Above average";
          else if (gap < -5) remark = "Below average";

          return {
            teacherId: tp.teacherId,
            teacherName: tp.teacherName,
            subject: Array.from(tp.subjects).join(", "),
            classCount: tp.classIds.size,
            classAvg,
            schoolAvg,
            gap,
            remark,
          };
        })
        .sort((a, b) => b.gap - a.gap);

      // Subject overview — mean accuracy across every class teaching the subject.
      const subjectMap = new Map<string, {
        subjectId: string;
        subjectName: string;
        acc: number[];
        topClassAvg: number;
        topClassName: string;
        seenClasses: Set<string>;
      }>();
      for (const ta of teacherAssignments) {
        const subjectId = ta.subject_id || "";
        if (!subjectId) continue;
        let entry = subjectMap.get(subjectId);
        if (!entry) {
          entry = {
            subjectId,
            subjectName: pickOne(ta.subjects)?.name || "General",
            acc: [],
            topClassAvg: 0,
            topClassName: "",
            seenClasses: new Set(),
          };
          subjectMap.set(subjectId, entry);
        }
        if (entry.seenClasses.has(ta.class_id)) continue;
        entry.seenClasses.add(ta.class_id);
        const cs = byClass.get(ta.class_id);
        if (cs && cs.acc.length > 0) {
          entry.acc.push(...cs.acc);
          const classAvg = mean(cs.acc);
          if (classAvg > entry.topClassAvg) {
            entry.topClassAvg = classAvg;
            const cls = classes?.find(c => c.id === ta.class_id);
            entry.topClassName = cls ? formatClassName(cls.name, cls.section) : "";
          }
        }
      }

      const subjectOverview: SubjectOverview[] = Array.from(subjectMap.values())
        .filter(sp => sp.acc.length > 0)
        .map(sp => ({
          subjectId: sp.subjectId,
          subjectName: sp.subjectName,
          schoolAvg: mean(sp.acc),
          topClassAvg: sp.topClassAvg,
          topClassName: sp.topClassName,
        }))
        .sort((a, b) => b.schoolAvg - a.schoolAvg);

      return {
        heatmapData,
        underperformingClasses,
        teacherPerformance,
        subjectOverview,
        schoolAvg,
        totalClasses: classes?.length || 0,
        totalTeachers: teachers?.length || 0,
      };
    },
    enabled: !!institutionId,
    staleTime: 60_000,
  });
}

export function usePrincipalClassDrilldown(institutionId: string | null, classId: string | null) {
  return useQuery({
    queryKey: ["principal-class-drilldown", institutionId, classId],
    queryFn: async () => {
      if (!institutionId || !classId) return null;

      // Get class details
      const { data: classData } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("id", classId)
        .single();

      // Get teacher for this class
      const { data: teacherAssignment } = await supabase
        .from("class_assignments")
        .select(`
          user_id,
          subject_id,
          profiles:user_id(full_name),
          subjects:subject_id(name)
        `)
        .eq("class_id", classId)
        .eq("role", "teacher")
        .maybeSingle();

      // Get student performance snapshots for this class (explicit columns +
      // range guard against PostgREST's silent 1000-row cap).
      const { data: snapshotsRaw } = await supabase
        .from("student_performance_snapshots")
        .select(`
          student_id,
          accuracy_percent,
          avg_time_per_question_seconds,
          efficiency_score,
          profiles:student_id(id, full_name)
        `)
        .eq("class_id", classId)
        .range(0, 9999);
      const snapshots = (snapshotsRaw ?? []) as unknown as DrilldownSnapshotRow[];

      // Class + school averages come from live snapshots (class_aggregates is
      // dead — see usePrincipalOverview). classAvg = mean of THIS class's
      // snapshots; schoolAvg + top class computed from every active class in
      // the institution.
      const classAvg = snapshots?.length
        ? snapshots.reduce((sum, s) => sum + Number(s.accuracy_percent || 0), 0) / snapshots.length
        : 0;

      const { data: institutionClasses } = await supabase
        .from("classes")
        .select("id")
        .eq("institution_id", institutionId)
        .eq("is_active", true);

      const institutionClassIds = institutionClasses?.map(c => c.id) || [];
      const { data: schoolSnapshotsRaw } = institutionClassIds.length > 0
        ? await supabase
            .from("student_performance_snapshots")
            .select("class_id, accuracy_percent")
            .in("class_id", institutionClassIds)
            .range(0, 9999)
        : { data: [] };
      const schoolSnapshots = (schoolSnapshotsRaw ?? []) as { class_id: string; accuracy_percent: number | null }[];

      const schoolAvg = schoolSnapshots.length
        ? schoolSnapshots.reduce((sum, s) => sum + Number(s.accuracy_percent || 0), 0) / schoolSnapshots.length
        : 0;

      // Build student list — one row per DISTINCT student (a student can have
      // several exam snapshots), mean of their snapshots. Keeps students.length
      // in step with the heatmap tile's distinct-student count for this class.
      const studentAgg = new Map<string, { name: string; acc: number[]; time: number[]; eff: number[] }>();
      for (const s of snapshots) {
        let entry = studentAgg.get(s.student_id);
        if (!entry) {
          entry = { name: getDisplayName(s.profiles), acc: [], time: [], eff: [] };
          studentAgg.set(s.student_id, entry);
        }
        entry.acc.push(Number(s.accuracy_percent) || 0);
        entry.time.push(Number(s.avg_time_per_question_seconds) || 0);
        entry.eff.push(Number(s.efficiency_score) || 0);
      }
      const students = Array.from(studentAgg.entries())
        .map(([studentId, entry]) => {
          const accuracy = mean(entry.acc);
          return {
            studentId,
            studentName: entry.name,
            accuracy,
            avgTime: mean(entry.time),
            efficiency: mean(entry.eff),
            deviation: accuracy - classAvg,
          };
        })
        .sort((a, b) => b.accuracy - a.accuracy);

      // Score distribution over distinct students. Bands are contiguous
      // (upper-inclusive) so a fractional score like 30.5 can never fall
      // between two buckets.
      const scoreBands = [
        { range: "0-30%", hi: 30, color: "hsl(var(--destructive))" },
        { range: "31-50%", hi: 50, color: "hsl(var(--warning))" },
        { range: "51-70%", hi: 70, color: "hsl(var(--muted))" },
        { range: "71-85%", hi: 85, color: "hsl(var(--primary))" },
        { range: "86-100%", hi: 100, color: "hsl(var(--success))" },
      ];

      const scoreDistribution = scoreBands.map((band, i) => {
        const lo = i === 0 ? -Infinity : scoreBands[i - 1].hi;
        return {
          range: band.range,
          count: students.filter(s => s.accuracy > lo && s.accuracy <= band.hi).length,
          color: band.color,
        };
      });

      // Generate suggestions based on data
      const suggestions: string[] = [];
      
      if (classAvg < schoolAvg - 10) {
        suggestions.push(`This class is performing ${(schoolAvg - classAvg).toFixed(1)}% below school average. Consider additional support.`);
      }
      
      const lowPerformers = students.filter(s => s.accuracy < 50).length;
      if (lowPerformers > students.length * 0.3) {
        suggestions.push(`${lowPerformers} students (${((lowPerformers / students.length) * 100).toFixed(0)}%) are below 50%. Consider remedial sessions.`);
      }
      
      const slowStudents = students.filter(s => s.avgTime > 60).length;
      if (slowStudents > students.length * 0.2) {
        suggestions.push("Several students are taking too long per question. Practice timed exercises.");
      }

      // Top class = highest per-class mean accuracy across the institution.
      const classAccSums = new Map<string, { sum: number; n: number }>();
      for (const s of schoolSnapshots) {
        const e = classAccSums.get(s.class_id) ?? { sum: 0, n: 0 };
        e.sum += Number(s.accuracy_percent || 0);
        e.n += 1;
        classAccSums.set(s.class_id, e);
      }
      const topClassPercent = Array.from(classAccSums.values())
        .reduce((max, e) => Math.max(max, e.n ? e.sum / e.n : 0), 0);

      const drilldownSubject = pickOne(
        (teacherAssignment?.subjects ?? null) as { name: string | null } | { name: string | null }[] | null
      );

      return {
        classId,
        grade: classData?.name || "",
        section: classData?.section || "",
        subject: drilldownSubject?.name || "General",
        teacherName: teacherAssignment ? getDisplayName(teacherAssignment.profiles, "Unassigned") : "Unassigned",
        classAvg,
        schoolAvg,
        topClassPercent,
        scoreDistribution,
        students,
        suggestions,
      };
    },
    enabled: !!institutionId && !!classId,
    staleTime: 60_000,
  });
}
