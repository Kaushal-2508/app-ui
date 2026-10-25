import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClassAggregate {
  class_id: string;
  exam_id: string;
  avg_accuracy_percent: number;
  avg_time_per_question_seconds: number;
  avg_efficiency_score: number;
  students_attempted: number;
  students_passed: number;
  total_students: number;
  topper_student_id: string | null;
  topper_accuracy_percent: number;
  topper_name: string | null;
}

const ALLOWED_ROLES = new Set([
  "super_admin",
  "super_school_admin",
  "school_admin",
  "coordinator",
  "teacher",
]);

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth gate: previously this function ran with service-role credentials
    // and no caller verification — anyone with the URL could recompute
    // aggregates for any institution.
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const jwt = authHeader.slice('Bearer '.length);
    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
    );
    const { data: userData, error: authError } = await anonClient.auth.getUser(jwt);
    if (authError || !userData?.user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }
    const { data: roleRows } = await anonClient
      .from('user_roles')
      .select('role')
      .eq('user_id', userData.user.id)
      .limit(10);
    const allowed = (roleRows ?? []).some((r) => ALLOWED_ROLES.has(r.role as string));
    if (!allowed) {
      return new Response(
        JSON.stringify({ error: 'Forbidden' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { exam_id, institution_id, compute_all } = await req.json();

    console.log("Computing aggregates for:", { exam_id, institution_id, compute_all });

    // Get exams to process - include published, active, and completed exams
    let examsQuery = supabase.from("exams").select("id, institution_id").in("status", ["published", "active", "completed"]);
    
    if (exam_id) {
      examsQuery = examsQuery.eq("id", exam_id);
    } else if (institution_id) {
      examsQuery = examsQuery.eq("institution_id", institution_id);
    }

    const { data: exams, error: examsError } = await examsQuery;
    if (examsError) throw examsError;

    console.log(`Processing ${exams?.length || 0} exams`);

    const results: { exam_id: string; classes_updated: number }[] = [];

    for (const exam of exams || []) {
      // Get all classes for this exam
      const { data: examClasses } = await supabase
        .from("exam_classes")
        .select("class_id")
        .eq("exam_id", exam.id);

      for (const ec of examClasses || []) {
        // Get all student snapshots for this class and exam
        const { data: snapshots } = await supabase
          .from("student_performance_snapshots")
          .select(`
            *,
            profiles:student_id(id, full_name)
          `)
          .eq("class_id", ec.class_id)
          .eq("exam_id", exam.id);

        if (!snapshots || snapshots.length === 0) continue;

        // Calculate aggregates
        const totalStudents = snapshots.length;
        const avgAccuracy = snapshots.reduce((sum, s) => sum + Number(s.accuracy_percent), 0) / totalStudents;
        const avgTime = snapshots.reduce((sum, s) => sum + Number(s.avg_time_per_question_seconds), 0) / totalStudents;
        const avgEfficiency = snapshots.reduce((sum, s) => sum + Number(s.efficiency_score), 0) / totalStudents;

        // Get final results for pass count
        const attemptIds = snapshots.map(s => s.attempt_id);
        const { data: finalResults } = await supabase
          .from("final_results")
          .select("is_pass")
          .in("attempt_id", attemptIds);

        const passedCount = finalResults?.filter(r => r.is_pass).length || 0;

        // Find topper
        const topper = snapshots.reduce((max, s) => 
          Number(s.accuracy_percent) > Number(max?.accuracy_percent || 0) ? s : max
        , snapshots[0]);

        const topperName = (topper?.profiles as any)?.full_name || null;

        // Upsert class aggregate
        const { error: upsertError } = await supabase
          .from("class_aggregates")
          .upsert({
            class_id: ec.class_id,
            exam_id: exam.id,
            avg_accuracy_percent: avgAccuracy,
            avg_time_per_question_seconds: avgTime,
            avg_efficiency_score: avgEfficiency,
            avg_score_percent: avgAccuracy, // Same as accuracy for now
            students_attempted: totalStudents,
            students_passed: passedCount,
            total_students: totalStudents,
            topper_student_id: topper?.student_id || null,
            topper_accuracy_percent: Number(topper?.accuracy_percent || 0),
            topper_time_per_question_seconds: Number(topper?.avg_time_per_question_seconds || 0),
            topper_name: topperName,
            computed_at: new Date().toISOString(),
          }, {
            onConflict: 'class_id,exam_id',
          });

        if (upsertError) {
          console.error("Error upserting class aggregate:", upsertError);
        }

        // Update student snapshots with class comparison data
        for (const snapshot of snapshots) {
          await supabase
            .from("student_performance_snapshots")
            .update({
              class_avg_accuracy: avgAccuracy,
              topper_accuracy: Number(topper?.accuracy_percent || 0),
              deviation_from_class: Number(snapshot.accuracy_percent) - avgAccuracy,
              deviation_from_topper: Number(snapshot.accuracy_percent) - Number(topper?.accuracy_percent || 0),
            })
            .eq("id", snapshot.id);
        }
      }

      results.push({
        exam_id: exam.id,
        classes_updated: examClasses?.length || 0,
      });
    }

    // Compute school aggregates if institution_id provided
    if (institution_id) {
      console.log("Computing school aggregates for institution:", institution_id);

      // Get all classes for institution
      const { data: classes } = await supabase
        .from("classes")
        .select("id, name, section")
        .eq("institution_id", institution_id)
        .eq("is_active", true);

      if (classes && classes.length > 0) {
        const classIds = classes.map(c => c.id);

        // Get all class aggregates
        const { data: classAggs } = await supabase
          .from("class_aggregates")
          .select("*")
          .in("class_id", classIds);

        if (classAggs && classAggs.length > 0) {
          // Calculate school-wide average
          const schoolAvg = classAggs.reduce((sum, a) => sum + Number(a.avg_accuracy_percent), 0) / classAggs.length;

          // Build grade-section heatmap
          const heatmapData = classes.map(cls => {
            const classAgg = classAggs.filter(a => a.class_id === cls.id);
            const avgPercent = classAgg.length > 0
              ? classAgg.reduce((sum, a) => sum + Number(a.avg_accuracy_percent), 0) / classAgg.length
              : 0;
            const studentCount = classAgg.reduce((sum, a) => sum + (a.students_attempted || 0), 0);

            return {
              classId: cls.id,
              grade: cls.name,
              section: cls.section || "A",
              avgPercent,
              studentCount,
            };
          });

          // Identify underperforming classes
          const underperformingClasses = heatmapData
            .filter(h => h.avgPercent < (schoolAvg - 10) || h.avgPercent < 50)
            .map(h => ({
              classId: h.classId,
              grade: h.grade,
              section: h.section,
              classAvg: h.avgPercent,
              schoolAvg,
              gap: schoolAvg - h.avgPercent,
            }));

          // Upsert school aggregate
          await supabase
            .from("school_aggregates")
            .upsert({
              institution_id,
              computed_at: new Date().toISOString(),
              total_students: classAggs.reduce((sum, a) => sum + (a.students_attempted || 0), 0),
              total_exams: new Set(classAggs.map(a => a.exam_id)).size,
              avg_accuracy_percent: schoolAvg,
              avg_pass_rate: classAggs.reduce((sum, a) => 
                sum + ((a.students_passed || 0) / Math.max(a.students_attempted || 1, 1)) * 100, 0) / classAggs.length,
              grade_section_heatmap: heatmapData,
              underperforming_classes: underperformingClasses,
            }, {
              onConflict: 'institution_id',
            });
        }
      }
    }

    console.log("Aggregates computed successfully:", results);

    return new Response(
      JSON.stringify({ success: true, results }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error computing aggregates:", error);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
