#!/usr/bin/env bash
#
# Staging promote-on-merge (docs/ops/04 §5): for each affected worker, promote
# the PR-built version (uploaded by .rwx/preview.yml, tagged pr-<n>-<head-sha>)
# instead of rebuilding — falling back to a full build+deploy whenever a
# version can't or shouldn't be promoted. Unchanged workers are never touched.
#
# Per-worker decision, in canonical order (bouncer LAST — error-10143 history
# in .rwx/deploy.yml):
#   1. migrations: ALWAYS `deploy-worker.sh migrate <w> staging` first for
#      affected workers (wrangler's ledger makes it an idempotent no-op when
#      nothing is pending; migrate-before-code is the invariant).
#   2. `workers/<w>/wrangler.jsonc` in the diff -> FULL deploy (config changes —
#      bindings/routes/crons/DO migrations — cannot ride a version).
#   3. else: resolve the merged PR (commits/<merge-sha>/pulls), find the newest
#      version tagged `pr-<pr>-<pr-head-sha>` -> `wrangler versions deploy
#      <id>@100% -y`. Tag uses the PR HEAD sha (what previews built), never the
#      merge sha — squash merges make them differ.
#   4. no PR / no version (previews disabled, direct push, >100 versions ago)
#      -> FULL deploy. Loud per-worker logging either way.
#
# Inputs (env): CHANGED    space-joined affected workers
#               FILES      path to the changed-file list (one per line)
#               SHA        the pushed (merge) commit sha
#               FORCE_FULL "true" to skip promotion entirely (disaster lever)
# Requires: GH_TOKEN (PR lookup), CLOUDFLARE_API_TOKEN (wrangler).
set -euo pipefail

CHANGED="${CHANGED:-}"
FILES="${FILES:?changed-file list path required}"
SHA="${SHA:?commit sha required}"
FORCE_FULL="${FORCE_FULL:-false}"
REPO="apostolos-geyer/somewhatintelligent"
ORDER=(promoter roadie guestlist identity store bouncer)

# Per-worker GitHub Deployment records (env `staging/<worker>`, CF-dashboard +
# live-URL links) — best-effort helpers, sourced so BOTH ship paths below
# (version promotion and full deploy) record identically. The summary comment
# itself is flushed by the calling lane (.rwx/promote-staging.yml).
# shellcheck source=scripts/rwx-github-deployment.sh
source "$(dirname "$0")/rwx-github-deployment.sh"

if [ -z "${CHANGED}" ]; then
  echo "promote-staging: no affected workers — nothing to deploy"
  exit 0
fi

pr_number="" pr_head=""
if [ "${FORCE_FULL}" != "true" ]; then
  pulls="$(gh api "repos/${REPO}/commits/${SHA}/pulls" 2>/dev/null || echo '[]')"
  pr_number="$(jq -r '[.[] | select(.merged_at != null)][0].number // empty' <<<"${pulls}")"
  pr_head="$(jq -r '[.[] | select(.merged_at != null)][0].head.sha // empty' <<<"${pulls}")"
  if [ -n "${pr_number}" ]; then
    echo "promote-staging: merge of PR #${pr_number} (head ${pr_head})"
  else
    echo "promote-staging: no merged PR for ${SHA} — full deploys for all affected workers"
  fi
fi

for w in "${ORDER[@]}"; do
  grep -qw "${w}" <<<"${CHANGED}" || continue
  echo "== ${w} =="
  bash scripts/deploy-worker.sh migrate "${w}" staging

  mode="full"
  if [ "${FORCE_FULL}" != "true" ] && [ -n "${pr_number}" ] && ! grep -q "^workers/${w}/wrangler.jsonc$" "${FILES}"; then
    tag="pr-${pr_number}-${pr_head}"
    vid="$(cd "workers/${w}" && bunx wrangler versions list --json 2>/dev/null |
      jq -r --arg tag "${tag}" '[.[] | select(.annotations["workers/tag"] == $tag)] | sort_by(.metadata.created_on) | last | .id // empty' || true)"
    if [ -n "${vid}" ]; then
      echo "${w}: promoting version ${vid} (tag ${tag})"
      if (cd "workers/${w}" && bunx wrangler versions deploy "${vid}@100%" -y); then
        mode="promoted"
      else
        echo "${w}: promotion FAILED — falling back to full deploy" >&2
      fi
    else
      echo "${w}: no version tagged ${tag} (previews disabled or expired) — full deploy"
    fi
  elif grep -q "^workers/${w}/wrangler.jsonc$" "${FILES}"; then
    echo "${w}: wrangler.jsonc changed — config cannot ride a version; full deploy"
  fi

  if [ "${mode}" != "promoted" ]; then
    bash scripts/deploy-worker.sh deploy "${w}" staging
    mode="deployed"
  fi
  echo "${w}: ${mode}"
  gh_worker_deployment "${w}" "${SHA}"
done
