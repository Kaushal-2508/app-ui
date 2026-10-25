#!/usr/bin/env bash
# Runs probe-capture-all.sql over every account in batches and prints each batch summary.
# Usage: bash scripts/dua/run-probe.sh [BATCH_SIZE]
set -u
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
BATCH="${1:-100}"
TMP="$(mktemp -d)"
TOTAL=$(cd "$REPO" && printf "SELECT count(*) AS n FROM auth.users;\n" > "$TMP/count.sql" && \
  powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TMP/count.sql" -OutFile "$TMP/count.json" >/dev/null && \
  node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,''))[0].n)" "$TMP/count.json")
echo "accounts: $TOTAL, batch: $BATCH"
for ((off = 0; off < TOTAL; off += BATCH)); do
  sed "s/__OFFSET__/$off/; s/__LIMIT__/$BATCH/" "$REPO/scripts/dua/probe-capture-all.sql" > "$TMP/batch.sql"
  start=$(date +%s)
  (cd "$REPO" && powershell -NoProfile -File scripts/run-sql.ps1 -SqlFile "$TMP/batch.sql" -OutFile "$TMP/batch-$off.json" >/dev/null)
  echo "== offset $off ($(( $(date +%s) - start ))s)"
  node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8').replace(/^\uFEFF/,''));if(!Array.isArray(r)){console.log('  BATCH ERROR',JSON.stringify(r).slice(0,400));process.exit()}for(const x of r)console.log('  '+x.outcome+' complete='+x.is_complete+' n='+x.accounts+' max_ms='+x.max_ms+' avg_ms='+x.avg_ms+' max_rows='+x.max_rows+(x.problems?' problems='+JSON.stringify(x.problems).slice(0,600):''))" "$TMP/batch-$off.json"
done
