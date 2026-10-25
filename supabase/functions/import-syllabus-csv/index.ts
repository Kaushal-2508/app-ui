import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_CATEGORIES = ['core', 'elective', 'language', 'vocational'] as const;
type ValidCategory = typeof VALID_CATEGORIES[number];

const DEVANAGARI_PATTERN = /[\u0900-\u097F]/;

interface CSVRow {
  grade_name: string;
  subject_name: string;
  subject_category: string;
  topic_name: string;
}

interface ProcessingStats {
  subjectsCreated: number;
  subjectsSkipped: number;
  topicsCreated: number;
  topicsSkipped: number;
  errors: string[];
}

function normalizeCategory(category: string | undefined): ValidCategory {
  if (!category) return 'core';
  const lower = category.toLowerCase().trim();
  if (VALID_CATEGORIES.includes(lower as ValidCategory)) return lower as ValidCategory;
  return 'core';
}

function isHindiText(text: string | null | undefined): boolean {
  if (!text) return false;
  return DEVANAGARI_PATTERN.test(text);
}

function extractLanguages(text: string | null | undefined): { english: string | null; hindi: string | null } {
  if (!text || !text.trim()) return { english: null, hindi: null };
  const trimmed = text.trim();
  const separatorMatch = trimmed.match(/^(.+?)\s*[|\/\-]\s*(.+)$/);
  if (separatorMatch) {
    const [, part1, part2] = separatorMatch;
    const isFirstHindi = isHindiText(part1);
    const isSecondHindi = isHindiText(part2);
    if (isFirstHindi !== isSecondHindi) {
      return {
        english: isFirstHindi ? part2.trim() : part1.trim(),
        hindi: isFirstHindi ? part1.trim() : part2.trim(),
      };
    }
  }
  if (isHindiText(trimmed)) return { english: null, hindi: trimmed };
  return { english: trimmed, hindi: null };
}

function parseCSV(csvText: string): CSVRow[] {
  const lines = csvText.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  const rows: CSVRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; }
      else if (char === ',' && !inQuotes) { values.push(current.trim().replace(/^["']|["']$/g, '')); current = ''; }
      else { current += char; }
    }
    values.push(current.trim().replace(/^["']|["']$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] || ''; });
    if (row.grade_name && row.subject_name && row.topic_name) {
      rows.push({ grade_name: row.grade_name, subject_name: row.subject_name, subject_category: row.subject_category || '', topic_name: row.topic_name });
    }
  }
  return rows;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // === AUTH CHECK ===
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: userData, error: userError } = await anonClient.auth.getUser(token);
    if (userError || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerUserId = userData.user.id;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // === ROLE CHECK: admin/super_admin only ===
    const { data: roleData } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerUserId)
      .in("role", ["super_admin", "super_school_admin", "school_admin"])
      .limit(1)
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Forbidden: admin role required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    let csvData = body.csvData;
    
    if (body.csvUrl && !csvData) {
      const response = await fetch(body.csvUrl);
      if (!response.ok) {
        return new Response(
          JSON.stringify({ error: `Failed to fetch CSV from URL: ${response.statusText}` }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      csvData = await response.text();
    }
    
    if (!csvData) {
      return new Response(
        JSON.stringify({ error: "CSV data or csvUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const rows = parseCSV(csvData);
    console.log(`Parsed ${rows.length} valid rows from CSV`);

    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ error: "No valid rows found in CSV. Ensure columns: grade_name, subject_name, subject_category, topic_name" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stats: ProcessingStats = { subjectsCreated: 0, subjectsSkipped: 0, topicsCreated: 0, topicsSkipped: 0, errors: [] };

    // STEP 1: Fetch all existing grades
    const { data: grades, error: gradesError } = await supabase.from("grade_levels").select("id, grade_name");
    if (gradesError) throw gradesError;

    const gradeMap = new Map<string, string>();
    (grades || []).forEach(g => { gradeMap.set(g.grade_name.toLowerCase().trim(), g.id); });

    const csvGradeNames = new Set(rows.map(r => r.grade_name.toLowerCase().trim()));
    const missingGrades = [...csvGradeNames].filter(g => !gradeMap.has(g));
    
    if (missingGrades.length > 0) {
      return new Response(
        JSON.stringify({ error: `Missing grades in database: ${missingGrades.slice(0, 10).join(", ")}. Please create these grades first.`, missingGrades }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // STEP 2: Fetch existing subjects
    const { data: subjects, error: subjectsError } = await supabase.from("universal_subjects").select("id, name, name_hindi, category, grade_level_id");
    if (subjectsError) throw subjectsError;

    const subjectMap = new Map<string, { id: string; name: string | null; name_hindi: string | null; category: string }>();
    (subjects || []).forEach(s => {
      if (s.grade_level_id) {
        if (s.name) subjectMap.set(`${s.grade_level_id}-${s.name.toLowerCase().trim()}`, { id: s.id, name: s.name, name_hindi: s.name_hindi, category: s.category });
        if (s.name_hindi) subjectMap.set(`${s.grade_level_id}-hindi-${s.name_hindi.toLowerCase().trim()}`, { id: s.id, name: s.name, name_hindi: s.name_hindi, category: s.category });
      }
    });

    // STEP 3: Create subjects
    const csvGradeSubjects = new Map<string, { gradeId: string; name: string | null; name_hindi: string | null; originalName: string; category: ValidCategory }>();
    rows.forEach(row => {
      const gradeKey = row.grade_name.toLowerCase().trim();
      const gradeId = gradeMap.get(gradeKey);
      if (!gradeId) return;
      const subjectNameTrimmed = row.subject_name.trim();
      const { english: subjectEnglish, hindi: subjectHindi } = extractLanguages(subjectNameTrimmed);
      const subjectKey = isHindiText(subjectNameTrimmed) ? `${gradeId}-hindi-${subjectNameTrimmed.toLowerCase()}` : `${gradeId}-${subjectNameTrimmed.toLowerCase()}`;
      if (!csvGradeSubjects.has(subjectKey)) {
        csvGradeSubjects.set(subjectKey, { gradeId, name: subjectEnglish, name_hindi: subjectHindi, originalName: subjectNameTrimmed, category: normalizeCategory(row.subject_category) });
      }
    });

    for (const [key, subjectData] of csvGradeSubjects) {
      if (!subjectMap.has(key)) {
        const { data: newSubject, error: insertError } = await supabase
          .from("universal_subjects")
          .insert({ name: subjectData.name, name_hindi: subjectData.name_hindi, category: subjectData.category, grade_level_id: subjectData.gradeId })
          .select("id, name, name_hindi, category")
          .single();

        if (insertError) {
          if (!insertError.message.includes('duplicate')) {
            stats.errors.push(`Failed to create subject "${subjectData.originalName}": ${insertError.message}`);
          } else {
            let existing: any = null;
            if (subjectData.name) {
              const { data } = await supabase.from("universal_subjects").select("id, name, name_hindi, category").eq("grade_level_id", subjectData.gradeId).ilike("name", subjectData.name).maybeSingle();
              existing = data;
            } else if (subjectData.name_hindi) {
              const { data } = await supabase.from("universal_subjects").select("id, name, name_hindi, category").eq("grade_level_id", subjectData.gradeId).ilike("name_hindi", subjectData.name_hindi).maybeSingle();
              existing = data;
            }
            if (existing) { subjectMap.set(key, { id: existing.id, name: existing.name, name_hindi: existing.name_hindi, category: existing.category || "" }); stats.subjectsSkipped++; }
          }
        } else if (newSubject) {
          subjectMap.set(key, { id: newSubject.id, name: newSubject.name, name_hindi: newSubject.name_hindi, category: newSubject.category });
          stats.subjectsCreated++;
        }
      } else {
        stats.subjectsSkipped++;
      }
    }

    // STEP 4: Fetch existing topics with pagination
    const existingTopics: { grade_level_id: string; subject_id: string; topic_name: string | null; topic_name_hindi: string | null }[] = [];
    let offset = 0;
    const pageSize = 1000;
    while (true) {
      const { data: batch, error: topicsError } = await supabase.from("syllabus_topics").select("grade_level_id, subject_id, topic_name, topic_name_hindi").range(offset, offset + pageSize - 1);
      if (topicsError) throw topicsError;
      if (!batch || batch.length === 0) break;
      existingTopics.push(...batch);
      if (batch.length < pageSize) break;
      offset += pageSize;
    }

    const topicSet = new Set<string>();
    existingTopics.forEach(t => {
      if (t.topic_name) topicSet.add(`${t.grade_level_id}-${t.subject_id}-${t.topic_name.toLowerCase().trim()}`);
      if (t.topic_name_hindi) topicSet.add(`${t.grade_level_id}-${t.subject_id}-hindi-${t.topic_name_hindi.toLowerCase().trim()}`);
    });

    // STEP 5: Create missing topics
    const topicsToCreate: any[] = [];
    const pendingTopicKeys = new Set<string>();
    let displayOrder = existingTopics.length + 1;

    rows.forEach(row => {
      const gradeKey = row.grade_name.toLowerCase().trim();
      const gradeId = gradeMap.get(gradeKey);
      if (!gradeId) return;
      const subjectNameTrimmed = row.subject_name.trim();
      const subjectKey = isHindiText(subjectNameTrimmed) ? `${gradeId}-hindi-${subjectNameTrimmed.toLowerCase()}` : `${gradeId}-${subjectNameTrimmed.toLowerCase()}`;
      const subjectData = subjectMap.get(subjectKey);
      if (!subjectData) return;
      const topicNameTrimmed = row.topic_name.trim();
      const { english: topicEnglish, hindi: topicHindi } = extractLanguages(topicNameTrimmed);
      const topicKey = isHindiText(topicNameTrimmed) ? `${gradeId}-${subjectData.id}-hindi-${topicNameTrimmed.toLowerCase()}` : `${gradeId}-${subjectData.id}-${topicNameTrimmed.toLowerCase()}`;
      if (!topicSet.has(topicKey) && !pendingTopicKeys.has(topicKey)) {
        topicsToCreate.push({ grade_level_id: gradeId, subject_id: subjectData.id, topic_name: topicEnglish, topic_name_hindi: topicHindi, display_order: displayOrder++, is_active: true });
        pendingTopicKeys.add(topicKey);
      } else {
        stats.topicsSkipped++;
      }
    });

    const BATCH_SIZE = 100;
    for (let i = 0; i < topicsToCreate.length; i += BATCH_SIZE) {
      const batch = topicsToCreate.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase.from("syllabus_topics").insert(batch);
      if (insertError) {
        for (const topic of batch) {
          const { error: singleError } = await supabase.from("syllabus_topics").insert(topic);
          if (singleError) {
            if (!singleError.message.includes('duplicate')) {
              const displayName = topic.topic_name || topic.topic_name_hindi || 'Unknown';
              stats.errors.push(`Topic "${displayName}": ${singleError.message}`);
            }
          } else { stats.topicsCreated++; }
        }
      } else { stats.topicsCreated += batch.length; }
    }

    console.log(`Import complete: ${stats.subjectsCreated} subjects, ${stats.topicsCreated} topics created`);

    return new Response(
      JSON.stringify({ success: true, stats, message: `Created: ${stats.subjectsCreated} subjects, ${stats.topicsCreated} topics. Skipped: ${stats.subjectsSkipped} subjects, ${stats.topicsSkipped} topics.` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
