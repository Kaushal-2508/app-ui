// Show how a user is related to each task referenced in their notifications.
// For every notification with a task_id in metadata, we look up the task +
// its assignment row and label the user's role: assignee / assigner / supervisor.
//
// Usage:
//   SUPABASE_SERVICE_ROLE_KEY=... node scripts/check-notifications-role.mjs <email>
import { createClient } from "@supabase/supabase-js";

const EMAIL = (process.argv[2] || "urvashibatra13@gmail.com").toLowerCase();
const URL = "https://gyymkgohcijeksmrzuyw.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY env var");
  process.exit(1);
}
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

const { data: profile } = await sb
  .from("profiles")
  .select("id, full_name, email")
  .ilike("email", EMAIL)
  .maybeSingle();
if (!profile) { console.error("No profile for", EMAIL); process.exit(1); }

console.log(`=== ${profile.full_name} <${profile.email}> ===`);
console.log(`profile_id: ${profile.id}\n`);

const { data: notifs } = await sb
  .from("notifications")
  .select("id, created_at, type, title, message, is_read, metadata")
  .eq("user_id", profile.id)
  .order("created_at", { ascending: false })
  .limit(200);

// Pull every task_id mentioned in any notification's metadata
const taskIds = new Set();
for (const n of notifs ?? []) {
  const m = n.metadata ?? {};
  const id = m.task_id ?? m.taskId ?? m.task ?? null;
  if (id) taskIds.add(id);
}

let tasksById = new Map();
let assignmentsByTaskId = new Map();
let nameById = new Map();
if (taskIds.size > 0) {
  const ids = [...taskIds];
  const [{ data: tasks }, { data: assignments }] = await Promise.all([
    sb.from("tasks").select("id, title, status, task_type, priority, due_date, created_at").in("id", ids),
    sb.from("task_assignments").select("task_id, assigner_id, assignee_id, supervisor_id, assigned_at").in("task_id", ids),
  ]);
  for (const t of tasks ?? []) tasksById.set(t.id, t);
  for (const a of assignments ?? []) assignmentsByTaskId.set(a.task_id, a);

  // Resolve names for every distinct profile id we'll mention.
  const peopleIds = new Set();
  for (const a of assignments ?? []) {
    [a.assigner_id, a.assignee_id, a.supervisor_id].forEach((p) => p && peopleIds.add(p));
  }
  if (peopleIds.size > 0) {
    const { data: people } = await sb
      .from("profiles")
      .select("id, full_name, email")
      .in("id", [...peopleIds]);
    for (const p of people ?? []) nameById.set(p.id, p);
  }
}

const fmtPerson = (id) => {
  if (!id) return "—";
  const p = nameById.get(id);
  return p ? `${p.full_name} <${p.email}>` : id;
};

console.log("Notification → task linkage:\n");
for (const n of notifs ?? []) {
  const m = n.metadata ?? {};
  const tid = m.task_id ?? m.taskId ?? m.task ?? null;
  const t = tid ? tasksById.get(tid) : null;
  const a = tid ? assignmentsByTaskId.get(tid) : null;

  const roles = [];
  if (a) {
    if (a.assignee_id === profile.id) roles.push("ASSIGNEE");
    if (a.assigner_id === profile.id) roles.push("ASSIGNER");
    if (a.supervisor_id === profile.id) roles.push("SUPERVISOR");
  }
  const roleLabel = roles.length ? roles.join("+") : (tid ? "(no role)" : "(no task_id in metadata)");

  console.log(`[${n.created_at}] ${n.is_read ? "read " : "UNRD "} ${n.type.padEnd(22)} ${roleLabel}`);
  console.log(`    notif: ${n.title} — ${n.message}`);
  if (t) {
    console.log(`    task:  "${t.title}" (status=${t.status}, type=${t.task_type}, priority=${t.priority}, due=${t.due_date ?? "—"})`);
  } else if (tid) {
    console.log(`    task:  ${tid} (NOT FOUND — possibly deleted)`);
  }
  if (a) {
    console.log(`    asgn:  assigner=${fmtPerson(a.assigner_id)}`);
    console.log(`           assignee=${fmtPerson(a.assignee_id)}`);
    console.log(`           supervisor=${fmtPerson(a.supervisor_id)}`);
  }
  console.log();
}

// Aggregate role counts
const roleCounts = { ASSIGNEE: 0, ASSIGNER: 0, SUPERVISOR: 0, NONE: 0 };
for (const n of notifs ?? []) {
  const tid = (n.metadata ?? {}).task_id;
  const a = tid ? assignmentsByTaskId.get(tid) : null;
  if (!a) { roleCounts.NONE++; continue; }
  if (a.assignee_id === profile.id) roleCounts.ASSIGNEE++;
  else if (a.assigner_id === profile.id) roleCounts.ASSIGNER++;
  else if (a.supervisor_id === profile.id) roleCounts.SUPERVISOR++;
  else roleCounts.NONE++;
}
console.log("=== ROLE SUMMARY ===");
console.log(roleCounts);
