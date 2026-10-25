// Loads the harvested NDJSON into dua.legacy_evidence. Idempotent: the table
// is UNIQUE (source, kind, payload_md5) and inserts use ON CONFLICT DO NOTHING,
// so re-running after a new harvest only adds new evidence.
// Usage: node scripts/dua/load-legacy-evidence.cjs [IN_DIR]
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const IN = process.argv[2] || "D:/Salci Projects/Salci-Main-Portal/salci-evidence/dua-legacy-logs";
const REPO = path.resolve(__dirname, "..", "..");
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function ts(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" || /^\d+$/.test(String(v))) {
    const n = Number(v);
    return new Date(n > 1e14 ? n / 1000 : n > 1e11 ? n : n * 1000).toISOString(); // micro-, milli- or seconds
  }
  const d = new Date(String(v).replace(" ", "T").replace(/(\.\d{3})\d+/, "$1") + (/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? "" : "Z"));
  return isNaN(d) ? null : d.toISOString();
}

function* records(file, map) {
  const p = path.join(IN, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const rec = map(JSON.parse(line));
    if (rec) yield rec;
  }
}

const all = [
  ...records("auth_events.ndjson", (r) => {
    let msg; try { msg = JSON.parse(r.event_message); } catch { msg = { raw: r.event_message }; }
    const ev = msg.auth_audit_event || {};
    return {
      source: "auth_audit_logs", kind: ev.action || "unknown", event_at: ts(r.timestamp) || ts(ev.created_at),
      subject_user_id: (ev.traits && ev.traits.user_id) || null, actor_user_id: UUID.test(ev.actor_id || "") ? ev.actor_id : null,
      email: (ev.traits && ev.traits.user_email) || null, payload: msg,
    };
  }),
  ...records("auth_activity.ndjson", (r) => UUID.test(r.uid || "") ? {
    source: "auth_audit_logs", kind: "auth_activity", event_at: ts(r.last_at),
    // uid is inside the payload because the dedupe key is md5(payload): without it, two
    // people with the same day/count/last_at collapsed into one row (2026-10-07).
    subject_user_id: r.uid, actor_user_id: null, email: null,
    payload: { uid: r.uid, day: r.window_start.slice(0, 10), n: Number(r.n), last_at: r.last_at },
  } : null),
  ...records("function_deletes.ndjson", (r) => {
    const m = String(r.event_message || "");
    const by = m.match(/by user:\s*([0-9a-f-]{36})/i);
    const subj = m.match(/(?:Deleting user|deleted user|delete user)\D{0,12}([0-9a-f-]{36})/i);
    return {
      source: "function_logs", kind: "function_log", event_at: ts(r.timestamp),
      subject_user_id: subj ? subj[1] : null, actor_user_id: by ? by[1] : null, email: null,
      payload: { message: m, timestamp: r.timestamp },
    };
  }),
];

const BATCH = 300;
let loaded = 0;
for (let i = 0; i < all.length; i += BATCH) {
  const json = JSON.stringify(all.slice(i, i + BATCH));
  if (json.includes("$dua_json$")) throw new Error("payload contains the dollar-quote tag");
  const sql = `INSERT INTO dua.legacy_evidence (source, kind, event_at, subject_user_id, actor_user_id, email, payload)
SELECT x.source, x.kind, x.event_at, x.subject_user_id, x.actor_user_id, x.email, x.payload
FROM jsonb_to_recordset($dua_json$${json}$dua_json$::jsonb)
  AS x(source text, kind text, event_at timestamptz, subject_user_id uuid, actor_user_id uuid, email text, payload jsonb)
ON CONFLICT (source, kind, payload_md5) DO NOTHING;`;
  const f = path.join(os.tmpdir(), `dua-load-${i}.sql`);
  fs.writeFileSync(f, sql, "utf8");
  const out = path.join(os.tmpdir(), `dua-load-${i}.json`);
  execFileSync("powershell", ["-NoProfile", "-File", path.join(REPO, "scripts", "run-sql.ps1"), "-SqlFile", f, "-OutFile", out], { cwd: REPO });
  const body = fs.readFileSync(out, "utf8").replace(/^\uFEFF/, "");
  if (body.includes('"message"')) throw new Error(`batch ${i}: ${body.slice(0, 400)}`);
  loaded += Math.min(BATCH, all.length - i);
  process.stdout.write(`\rloaded ${loaded}/${all.length}   `);
}
console.log(`\ndone: ${all.length} records offered`);
