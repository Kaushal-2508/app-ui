// Copies the platform-log evidence about deleted users before it expires.
// The log store keeps a rolling 90 days and each query covers at most 24 h.
// Output is NDJSON per query in OUT_DIR. It contains emails, so it lives
// outside the repo. Read-only: GET requests only.
// Usage: node scripts/dua/harvest-platform-logs.cjs [OUT_DIR] [DAYS]
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const OUT = process.argv[2] || "D:/Salci Projects/Salci-Main-Portal/salci-evidence/dua-legacy-logs";
const DAYS = Number(process.argv[3] || 91);
const REF = "gyymkgohcijeksmrzuyw";
const GET = path.join(__dirname, "mgmt-get.ps1");
const TMP = path.join(os.tmpdir(), "dua-log-response.json");

// Every query ends in an explicit LIMIT; a window that returns CAP rows is split
// in half and re-queried, so nothing is silently truncated.
const CAP = 1000;
const QUERIES = {
  auth_events:
    "select timestamp, event_message from logs where source = 'auth_audit_logs' and extract(event_message, '\"action\":\"([a-z_]+)\"') in ('user_deleted','user_signedup','user_invited','user_modified','user_repeated_signup','user_updated_password','user_recovery_requested') limit " + CAP,
  auth_activity:
    "select extract(event_message, '\"actor_id\":\"([0-9a-f-]{36})\"') as uid, toString(max(timestamp)) as last_at, count(*) as n from logs where source = 'auth_audit_logs' and extract(event_message, '\"action\":\"([a-z_]+)\"') in ('login','token_refreshed') group by uid limit " + CAP,
  function_deletes:
    "select timestamp, event_message from logs where source = 'function_logs' and positionCaseInsensitive(event_message, 'delet') > 0 limit " + CAP,
};

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function query(sql, start, end) {
  const p = `/v1/projects/${REF}/analytics/endpoints/logs?sql=${encodeURIComponent(sql)}` +
    `&iso_timestamp_start=${encodeURIComponent(start.toISOString())}&iso_timestamp_end=${encodeURIComponent(end.toISOString())}`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const status = execFileSync("powershell", ["-NoProfile", "-File", GET, "-Path", p, "-OutFile", TMP]).toString().trim();
    const body = fs.readFileSync(TMP, "utf8").replace(/^\uFEFF/, "");
    if (status.startsWith("HTTP 2")) {
      const json = JSON.parse(body);
      if (json.error) throw new Error(`${start.toISOString()} ${JSON.stringify(json.error).slice(0, 300)}`);
      return json.result || [];
    }
    sleep(4000 * attempt); // throttled or transient
  }
  throw new Error(`log query failed 3 times for ${start.toISOString()}`);
}

function harvestWindow(name, sql, start, end, out) {
  const rows = query(sql, start, end);
  sleep(1200);
  if (rows.length >= CAP) {
    if (end - start <= 60 * 1000) throw new Error(`${name}: ${CAP}+ rows in one minute at ${start.toISOString()}; lower the split floor`);
    const mid = new Date(start.getTime() + (end - start) / 2);
    return harvestWindow(name, sql, start, mid, out) + harvestWindow(name, sql, mid, end, out);
  }
  for (const r of rows) out.write(JSON.stringify({ query: name, window_start: start.toISOString(), ...r }) + "\n");
  return rows.length;
}

fs.mkdirSync(OUT, { recursive: true });
const now = new Date();
const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
const totals = {};
for (const [name, sql] of Object.entries(QUERIES)) {
  const out = fs.createWriteStream(path.join(OUT, `${name}.ndjson`), { flags: "w" });
  totals[name] = 0;
  for (let d = DAYS; d >= 0; d--) {
    const start = new Date(today.getTime() - d * 86400000);
    const end = new Date(Math.min(start.getTime() + 86400000, now.getTime()));
    if (end <= start) continue;
    totals[name] += harvestWindow(name, sql, start, end, out);
    process.stdout.write(`\r${name} ${start.toISOString().slice(0, 10)} rows=${totals[name]}   `);
  }
  out.end();
  process.stdout.write("\n");
}
console.log(JSON.stringify({ out: OUT, days: DAYS, totals }));
