// Diagnose why three Alliance teachers show 0/5 onboarding progress despite
// (per the user) having completed something. For each email we:
//   1. Find ALL profile rows matching the email (catches duplicates / case
//      mismatches — the most common cause of "I did the thing but the report
//      says No").
//   2. List the user_roles attached to every profile id we found.
//   3. Probe the five source tables the get_institution_onboarding_progress
//      RPC reads from, scoped to every profile id we found, and report row
//      counts + a small sample.
//   4. Also probe task_assignments where the user is the ASSIGNER (not just
//      assignee) — sometimes "I assigned tasks" gets confused with "I had a
//      task assigned to me", and the milestone only fires for the latter.
//   5. Run the RPC itself and print the row for each profile id.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-onboarding-zeros.mjs
import { createClient } from "@supabase/supabase-js";

const EMAILS = [
  "mkaur788872@gmail.com",        // Manpreet Kaur
  "poonam30.ais@gmail.com",       // Poonam Kamra
  "boxersidhu6565@gmail.com",     // Prabhjeet Singh
];

const URL = "https://gyymkgohcijeksmrzuyw.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const sep = (label) => console.log(`\n${"=".repeat(70)}\n${label}\n${"=".repeat(70)}`);

// --- 1. Find every profile row for these emails (incl. duplicates) -------
sep("PROFILES (ilike — catches case + accidental duplicates)");
const profilesByEmail = new Map();
for (const email of EMAILS) {
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name, email, institution_id, is_active, created_at")
    .ilike("email", email);
  if (error) { console.error(email, error); continue; }
  profilesByEmail.set(email, data ?? []);
  console.log(`\n${email}  →  ${data?.length ?? 0} profile row(s)`);
  for (const p of data ?? []) {
    console.log(`  • id=${p.id}  name=${p.full_name}  inst=${p.institution_id}  active=${p.is_active}  created=${p.created_at}`);
  }
}

// Collect every distinct profile id and the institution_id we'll RPC against
const allProfileIds = [];
const institutionIds = new Set();
for (const rows of profilesByEmail.values()) {
  for (const p of rows) {
    allProfileIds.push({ id: p.id, email: p.email, name: p.full_name, inst: p.institution_id });
    if (p.institution_id) institutionIds.add(p.institution_id);
  }
}

// --- 2. Roles ------------------------------------------------------------
sep("USER_ROLES per profile id");
for (const p of allProfileIds) {
  const { data } = await sb
    .from("user_roles")
    .select("role, institution_id")
    .eq("user_id", p.id);
  console.log(`\n${p.name} <${p.email}>  id=${p.id}`);
  console.log(`  roles:`, data ?? []);
}

// --- 3. Per-milestone evidence in source tables --------------------------
sep("MILESTONE EVIDENCE (raw rows in each source table, per profile id)");
for (const p of allProfileIds) {
  console.log(`\n--- ${p.name} <${p.email}>  id=${p.id} ---`);

  // (a) task_assignments where they are the ASSIGNEE
  const { count: asgnCount, data: asgnSample } = await sb
    .from("task_assignments")
    .select("id, task_id, assigner_id, assigned_at", { count: "exact" })
    .eq("assignee_id", p.id)
    .order("assigned_at", { ascending: false })
    .limit(5);
  console.log(`  task_assignments (assignee_id = me):  count=${asgnCount}`);
  for (const r of asgnSample ?? []) console.log(`     • ta.id=${r.id} task=${r.task_id} assigner=${r.assigner_id} at=${r.assigned_at}`);

  // (b) Same join the RPC does, with status='completed'
  if ((asgnCount ?? 0) > 0) {
    const taskIds = (asgnSample ?? []).map((r) => r.task_id);
    if (taskIds.length > 0) {
      const { data: tStat } = await sb
        .from("tasks")
        .select("id, title, status")
        .in("id", taskIds);
      console.log(`     statuses on first ${taskIds.length}:`, (tStat ?? []).map((t) => `${t.status}=${t.title}`));
    }
  }

  // (c) Also: where they are the ASSIGNER (people often confuse the two)
  const { count: assignerCount } = await sb
    .from("task_assignments")
    .select("id", { count: "exact", head: true })
    .eq("assigner_id", p.id);
  console.log(`  task_assignments (assigner_id = me, NOT a milestone): count=${assignerCount}`);

  // (d) study_materials they created
  const { count: smCount, data: smSample } = await sb
    .from("study_materials")
    .select("id, title, created_at", { count: "exact" })
    .eq("created_by", p.id)
    .order("created_at", { ascending: false })
    .limit(3);
  console.log(`  study_materials (created_by = me): count=${smCount}`);
  for (const r of smSample ?? []) console.log(`     • ${r.id}  ${r.title}  ${r.created_at}`);

  // (e) exams they created (any status)
  const { count: examCount, data: examSample } = await sb
    .from("exams")
    .select("id, title, status, created_at", { count: "exact" })
    .eq("created_by", p.id)
    .order("created_at", { ascending: false })
    .limit(5);
  console.log(`  exams (created_by = me, ANY status): count=${examCount}`);
  for (const r of examSample ?? []) console.log(`     • ${r.id}  status=${r.status}  ${r.title}  ${r.created_at}`);

  // (f) final_results validated by them
  const { count: frFinalized } = await sb
    .from("final_results")
    .select("id", { count: "exact", head: true })
    .eq("finalized_by", p.id);
  const { count: frPublished } = await sb
    .from("final_results")
    .select("id", { count: "exact", head: true })
    .eq("published_by", p.id);
  console.log(`  final_results: finalized_by=me count=${frFinalized}, published_by=me count=${frPublished}`);
}

// --- 4. Run the RPC and print the row for each profile id ----------------
sep("RPC: get_institution_onboarding_progress (what the report sees)");
for (const inst of institutionIds) {
  const { data, error } = await sb.rpc("get_institution_onboarding_progress", { _institution_id: inst });
  if (error) { console.error(`institution ${inst}:`, error); continue; }
  console.log(`\nInstitution ${inst}:  ${data?.length ?? 0} staff rows`);
  for (const p of allProfileIds) {
    const row = (data ?? []).find((r) => r.user_id === p.id);
    if (!row) {
      console.log(`  ${p.email}  (not in roster — RPC excluded this profile)`);
      continue;
    }
    console.log(
      `  ${p.email.padEnd(34)} role=${row.role.padEnd(11)} ` +
      `T${row.first_task_assigned ? "✓" : "·"} ` +
      `C${row.first_task_completed ? "✓" : "·"} ` +
      `M${row.first_study_material_uploaded ? "✓" : "·"} ` +
      `E${row.first_exam_published ? "✓" : "·"} ` +
      `R${row.first_result_validated ? "✓" : "·"}  ` +
      `= ${row.completed_count}/5`,
    );
  }
}

console.log("\nDone.");
