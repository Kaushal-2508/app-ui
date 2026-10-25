#!/usr/bin/env bash
# Vercel "Ignored Build Step". vercel.json calls it as:
#   "ignoreCommand": "bash scripts/vercel-ignore-build.sh || exit 1"
# Exit 0 = SKIP this deployment. Exit 1 = BUILD it. When in doubt, build.
#
# WHY IT EXISTS. Every build stamps a new sw.js, which reloads every open tab,
# so a push that changes only docs/, .claude/, supabase/ or scripts/ (none of
# which reach the site) is not deployed (introduced in c7479e0a, 2026-09-23).
#
# WHY THE BASE IS THE LAST DEPLOYMENT, NOT HEAD^. The first version compared
# HEAD^..HEAD, which sees only the LAST commit of a push. On 2026-10-05 a push
# ending in a docs-only merge (4fe8ee77) was skipped although the commits under
# it changed src/, and production stayed on the 2026-10-01 build until an
# unrelated push on 2026-10-06. The base is now VERCEL_GIT_PREVIOUS_SHA, "the
# last successful deployment for the project and branch": empty on a branch's
# first deployment, never a canceled or failed deployment, and HEAD itself on a
# Redeploy.
#
# RULES FOR EDITING
# - Every path ends in an explicit "exit 0" or "exit 1". Vercel can end a
#   deployment in ERROR on any other code, so there is no "set -e" or "set -u",
#   and the "|| exit 1" in vercel.json turns a crash of this file itself
#   (127 if missing, 2 if it does not parse) into a build.
# - Only the single "exit 0" below may skip.
# - LF line endings only (.gitattributes pins *.sh). Keep each git diff on one
#   line.
# - If the build ever reads anything under docs/, .claude/, supabase/ or
#   scripts/, take that folder off the exclude list, or changes there will not
#   deploy.

build() {
  echo "ignore-step: $*, building"
  exit 1
}

head_sha=$(git rev-parse --verify --quiet 'HEAD^{commit}' 2>/dev/null) || build "cannot read HEAD"

prev_raw=${VERCEL_GIT_PREVIOUS_SHA:-}
if [ -z "$prev_raw" ]; then
  [ -n "${VERCEL_GIT_COMMIT_SHA:-}" ] || build "no Vercel git variables reach this step (is 'Automatically expose System Environment Variables' off?)"
  build "no previous successful deployment for this branch"
fi

# Trust only a full hex commit id. A ref name, or a short id of this very
# commit, would resolve to HEAD and fake an empty diff.
case $prev_raw in
  *[!0123456789abcdefABCDEF]*) build "VERCEL_GIT_PREVIOUS_SHA '$prev_raw' is not a hex commit id" ;;
esac
case ${#prev_raw} in
  40|64) ;;
  *) build "VERCEL_GIT_PREVIOUS_SHA '$prev_raw' is not a full commit id" ;;
esac

prev=$(git rev-parse --verify --quiet "${prev_raw}^{commit}" 2>/dev/null) || build "last deployed commit $prev_raw is not in this shallow clone"
[ "$prev" != "$head_sha" ] || build "same commit as the last successful deployment (a redeploy)"

git diff --quiet --no-ext-diff --ignore-submodules=none "$prev" "$head_sha" -- . ':(exclude)docs' ':(exclude).claude' ':(exclude)supabase' ':(exclude)scripts'
rc=$?
if [ "$rc" -eq 0 ]; then
  echo "ignore-step: only docs/.claude/supabase/scripts changed since $prev, skipping"
  exit 0
fi
[ "$rc" -eq 1 ] || build "git diff against $prev failed with exit code $rc"
echo "ignore-step: app files changed since $prev (first 20):"
git diff --name-only --no-ext-diff --ignore-submodules=none "$prev" "$head_sha" -- . ':(exclude)docs' ':(exclude).claude' ':(exclude)supabase' ':(exclude)scripts' 2>/dev/null | head -n 20
build "app files changed"
