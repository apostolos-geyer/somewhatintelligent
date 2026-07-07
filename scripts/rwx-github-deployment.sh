# shellcheck shell=bash
#
# Best-effort GitHub Deployments reporting for RWX deploys, shared by every
# deploy lane (.rwx/deploy.yml, .rwx/promote-staging.yml,
# .rwx/release-please.yml, .rwx/release.yml).
# RWX reports commit *statuses* (checks) to GitHub, not GitHub *Deployments*;
# this script adds the Deployments/Environments timeline on top. Sourced by
# the lanes' deploy tasks, it provides two layers of visibility:
#
#   1. FLEET record (gh_deployment_create / gh_deployment_status): one
#      Deployment per run in environment `staging`/`production`, moved through
#      in_progress -> success/failure — the run-level pass/fail signal.
#   2. PER-WORKER records (gh_worker_deployment): one Deployment per shipped
#      worker in environment `<env>/<worker>` (e.g. `staging/guestlist`),
#      created AFTER that worker's wrangler deploy succeeded, carrying the
#      worker's version, its Cloudflare-dashboard deep link, and its public
#      URL when one exists — plus a compact commit/PR comment
#      (gh_deploy_summary_comment) that lists every worker shipped by the run
#      with those same links, upserted by marker so pushes update rather than
#      spam.
#
# The vendored inbox app (inbox/) deploys manually outside RWX, so nothing
# here records it.
#
# GH_DEPLOYMENT_ENV/GH_DEPLOYMENT_URL are set per-call by each lane's
# `deploy-env` alias (from `init.gh-deployment-env`/`init.gh-deployment-url`),
# so this one script serves both environments without a code change; the
# defaults below only apply to a bare local invocation.
#
# Best-effort by design: a missing/short-scoped token or any GitHub API hiccup
# logs a warning and returns 0, so deployment bookkeeping can NEVER turn an
# otherwise-green deploy red. `set -e` is intentionally NOT used here — it would
# leak into the caller, since this file is sourced, not executed.
#
# Requires GH_TOKEN to carry `deployments: write` (the RWX GitHub App's default
# statuses/checks scopes are NOT enough; the commit/PR summary comment
# additionally wants `pull-requests: write` — it degrades to a log line
# without it). GH_TOKEN is empty on local `rwx run` (cli trigger), in which
# case every function below cleanly no-ops.

GH_DEPLOYMENT_REPO="${GH_DEPLOYMENT_REPO:-apostolos-geyer/somewhatintelligent}"
GH_DEPLOYMENT_ENV="${GH_DEPLOYMENT_ENV:-staging}"
# Public entry point for the staging environment (the single-host apex). The
# domain's source of truth is packages/config/src/deploy.ts (baseDomain); the
# bouncer router serves the whole platform at staging.<baseDomain>.
GH_DEPLOYMENT_URL="${GH_DEPLOYMENT_URL:-https://staging.somewhatintelligent.ca}"
# Cloudflare account the dashboard links point into. CLOUDFLARE_ACCOUNT_ID is
# set by every lane's deploy-env alias; the literal fallback mirrors
# packages/config/src/deploy.ts `cloudflareAccountId`.
GH_DEPLOY_CF_ACCOUNT="${CLOUDFLARE_ACCOUNT_ID:-c735c5a53d864bee37400befb7f4c7f4}"
# Per-run scratch file the per-worker records append summary lines to; the
# fleet-level gh_deployment_create truncates it, so a runner reused across
# tasks never leaks a previous run's lines into this run's comment.
GH_DEPLOY_SUMMARY_FILE="${GH_DEPLOY_SUMMARY_FILE:-/tmp/gh-deploy-summary-${GH_DEPLOYMENT_ENV}.md}"

_gh_deployment_api() {
  curl -fsS \
    -H "Authorization: Bearer ${GH_TOKEN:-}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

# gh_deployment_create <ref>
# Creates the fleet-level deployment and exports GH_DEPLOYMENT_ID for the rest
# of this shell, and (if running under RWX) writes it to
# $RWX_ENV/GH_DEPLOYMENT_ID so downstream `use` tasks inherit it.
gh_deployment_create() {
  local ref="$1" id
  : > "${GH_DEPLOY_SUMMARY_FILE}" 2>/dev/null || true
  if [ -z "${GH_TOKEN:-}" ]; then
    echo "[gh-deploy] no GH_TOKEN — skipping GitHub deployment record" >&2
    return 0
  fi
  local is_prod=false
  [ "${GH_DEPLOYMENT_ENV}" = "production" ] && is_prod=true
  id=$(_gh_deployment_api -X POST \
    "https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/deployments" \
    -d "{\"ref\":\"${ref}\",\"environment\":\"${GH_DEPLOYMENT_ENV}\",\"auto_merge\":false,\"required_contexts\":[],\"production_environment\":${is_prod},\"description\":\"RWX ${GH_DEPLOYMENT_ENV} deploy\"}" \
    | jq -r '.id // empty') || {
    echo "[gh-deploy] deployment create failed (continuing)" >&2
    return 0
  }
  if [ -n "$id" ]; then
    export GH_DEPLOYMENT_ID="$id"
    [ -n "${RWX_ENV:-}" ] && echo "$id" > "${RWX_ENV}/GH_DEPLOYMENT_ID"
    echo "[gh-deploy] created deployment ${id} for ${ref}" >&2
  fi
}

# gh_deployment_status <state> [description]
# state is one of: in_progress | success | failure | error | inactive
gh_deployment_status() {
  local state="$1" desc="${2:-}"
  if [ -z "${GH_TOKEN:-}" ] || [ -z "${GH_DEPLOYMENT_ID:-}" ]; then
    return 0
  fi
  _gh_deployment_api -X POST \
    "https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/deployments/${GH_DEPLOYMENT_ID}/statuses" \
    -d "{\"state\":\"${state}\",\"environment\":\"${GH_DEPLOYMENT_ENV}\",\"environment_url\":\"${GH_DEPLOYMENT_URL}\",\"log_url\":\"${RWX_RUN_URL:-}\",\"description\":\"${desc}\"}" \
    >/dev/null \
    && echo "[gh-deploy] deployment ${GH_DEPLOYMENT_ID} -> ${state}" >&2 \
    || echo "[gh-deploy] deployment status post (${state}) failed (continuing)" >&2
  return 0
}

# ---------------------------------------------------------------------------
# Per-worker visibility
# ---------------------------------------------------------------------------

# The deployed Cloudflare script name for a worker in an env. Prefix mirrors
# packages/config/src/deploy.ts `workerPrefix` ("si"): workers deploy as
# `si-<worker>-staging` / `si-<worker>-production` (each wrangler.jsonc's
# `name` / `env.production.name`).
_cf_script_name() {
  local worker="$1" env="$2"
  printf 'si-%s-%s' "${worker}" "${env}"
}

# Cloudflare dashboard deep link for a worker service. Direct account-id form
# of the dashboard's workers-service URL (the account-relative deep-link form
# the CF docs/wrangler print is `https://dash.cloudflare.com/?to=/:account/
# workers/services/view/<script>/production` — same page; we have the account
# id, so link it directly). The trailing `production` is the legacy Cloudflare
# *service environment* (always "production"), NOT this platform's
# staging/production split — that split lives in the script NAME suffix.
_cf_dashboard_url() {
  local worker="$1" env="$2"
  printf 'https://dash.cloudflare.com/%s/workers/services/view/%s/production' \
    "${GH_DEPLOY_CF_ACCOUNT}" "$(_cf_script_name "${worker}" "${env}")"
}

# The account's workers.dev subdomain (e.g. "example-account"), resolved once
# per shell from the CF API using the deploy token already in the lane's env.
# Best-effort: empty string when the API/token can't answer.
_CF_WORKERS_SUBDOMAIN_CACHED=""
_cf_workers_subdomain() {
  if [ -n "${_CF_WORKERS_SUBDOMAIN_CACHED}" ]; then
    printf '%s' "${_CF_WORKERS_SUBDOMAIN_CACHED}"
    return 0
  fi
  [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && return 0
  _CF_WORKERS_SUBDOMAIN_CACHED="$(curl -fsS \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "https://api.cloudflare.com/client/v4/accounts/${GH_DEPLOY_CF_ACCOUNT}/workers/subdomain" \
    2>/dev/null | jq -r '.result.subdomain // empty' 2>/dev/null || true)"
  printf '%s' "${_CF_WORKERS_SUBDOMAIN_CACHED}"
}

# The public URL for a worker in an env, when one exists:
#   - bouncer owns the apex custom domains (the whole-platform entry point);
#   - service-bound workers get their workers.dev host (only live where the
#     worker's wrangler.jsonc has `workers_dev: true` — informational
#     otherwise) when the account subdomain resolves;
#   - empty when nothing resolves.
_worker_live_url() {
  local worker="$1" env="$2" sub
  case "${worker}:${env}" in
    bouncer:staging) printf 'https://staging.somewhatintelligent.ca'; return 0 ;;
    bouncer:production) printf 'https://somewhatintelligent.ca'; return 0 ;;
  esac
  sub="$(_cf_workers_subdomain)"
  [ -z "${sub}" ] && return 0
  printf 'https://%s.%s.workers.dev' "$(_cf_script_name "${worker}" "${env}")" "${sub}"
}

# gh_worker_deployment <worker> <ref>
# Records ONE GitHub Deployment for a worker that JUST shipped successfully:
# environment `<env>/<worker>`, immediate `success` status whose
# environment_url is the worker's live URL (dashboard link when no public URL
# exists), log_url the RWX run, and a payload carrying worker/version/
# dashboard_url/live_url for API consumers. Also appends the compact summary
# line for gh_deploy_summary_comment. Callers invoke this AFTER
# deploy-worker.sh (or a version promotion) returned 0 — a failed worker gets
# no per-worker record; the fleet record carries the failure.
gh_worker_deployment() {
  local worker="$1" ref="$2"
  local env="${GH_DEPLOYMENT_ENV}"
  local version dash live target id is_prod=false
  version="$(jq -r '.version // "0.0.0"' "workers/${worker}/package.json" 2>/dev/null || echo "0.0.0")"
  dash="$(_cf_dashboard_url "${worker}" "${env}")"
  live="$(_worker_live_url "${worker}" "${env}")"

  # Summary line first, in the fixed shape below — even with no GH_TOKEN the
  # run log carries it.
  local line
  if [ -n "${live}" ]; then
    line="deployed ${worker}@${version} to ${env}: ${live} | ${dash}"
  else
    line="deployed ${worker}@${version} to ${env}: (no public url) | ${dash}"
  fi
  echo "${line}" >> "${GH_DEPLOY_SUMMARY_FILE}" 2>/dev/null || true
  echo "[gh-deploy] ${line}" >&2

  if [ -z "${GH_TOKEN:-}" ]; then
    return 0
  fi
  [ "${env}" = "production" ] && is_prod=true
  target="${live:-${dash}}"
  id=$(_gh_deployment_api -X POST \
    "https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/deployments" \
    -d "{\"ref\":\"${ref}\",\"environment\":\"${env}/${worker}\",\"auto_merge\":false,\"required_contexts\":[],\"production_environment\":${is_prod},\"transient_environment\":false,\"description\":\"${worker}@${version} -> ${env}\",\"payload\":{\"worker\":\"${worker}\",\"version\":\"${version}\",\"dashboard_url\":\"${dash}\",\"live_url\":\"${live}\",\"rwx_run\":\"${RWX_RUN_URL:-}\"}}" \
    | jq -r '.id // empty') || {
    echo "[gh-deploy] per-worker deployment create failed for ${worker} (continuing)" >&2
    return 0
  }
  [ -z "${id}" ] && return 0
  _gh_deployment_api -X POST \
    "https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/deployments/${id}/statuses" \
    -d "{\"state\":\"success\",\"environment\":\"${env}/${worker}\",\"environment_url\":\"${target}\",\"log_url\":\"${RWX_RUN_URL:-}\",\"description\":\"${worker}@${version} deployed to ${env}\"}" \
    >/dev/null \
    && echo "[gh-deploy] worker deployment ${id} (${env}/${worker}) -> success" >&2 \
    || echo "[gh-deploy] worker deployment status post failed for ${worker} (continuing)" >&2
  return 0
}

# gh_deploy_summary_comment <sha>
# Upserts ONE compact comment summarizing every worker this run shipped (the
# lines gh_worker_deployment collected): on the merged PR when <sha> resolves
# to one (squash merges do), else on the commit itself. Idempotent per
# (environment) via an HTML marker — re-runs update in place, never spam.
gh_deploy_summary_comment() {
  local sha="$1"
  local marker="<!-- si-deploys:${GH_DEPLOYMENT_ENV} -->"
  if [ -z "${GH_TOKEN:-}" ]; then
    echo "[gh-deploy] no GH_TOKEN — skipping deploy summary comment" >&2
    return 0
  fi
  if [ ! -s "${GH_DEPLOY_SUMMARY_FILE}" ]; then
    echo "[gh-deploy] no per-worker deploys recorded — skipping summary comment" >&2
    return 0
  fi

  local body_file="/tmp/gh-deploy-comment-${GH_DEPLOYMENT_ENV}.md"
  {
    echo "${marker}"
    echo "### RWX deploy — ${GH_DEPLOYMENT_ENV}"
    echo ""
    echo "commit \`${sha}\` · [RWX run](${RWX_RUN_URL:-})"
    echo ""
    sed 's/^/- /' "${GH_DEPLOY_SUMMARY_FILE}"
  } > "${body_file}"

  # Prefer the merged PR (squash merges make <sha> the merge commit) so the
  # summary lands where the review conversation is; fall back to a commit
  # comment when no PR resolves (direct pushes, release edge cases).
  local pr
  pr="$(_gh_deployment_api "https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/commits/${sha}/pulls" 2>/dev/null |
    jq -r '[.[] | select(.merged_at != null)][0].number // empty' 2>/dev/null || true)"

  local list_url post_url existing
  if [ -n "${pr}" ]; then
    list_url="https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/issues/${pr}/comments?per_page=100"
    post_url="https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/issues/${pr}/comments"
    existing="$(_gh_deployment_api "${list_url}" 2>/dev/null |
      jq -r --arg m "${marker}" '[.[] | select(.body | startswith($m))][0].id // empty' 2>/dev/null || true)"
    # Issue and commit comments share the PATCH shape but not the endpoint.
    if [ -n "${existing}" ]; then
      post_url="https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/issues/comments/${existing}"
    fi
  else
    list_url="https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/commits/${sha}/comments?per_page=100"
    post_url="https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/commits/${sha}/comments"
    existing="$(_gh_deployment_api "${list_url}" 2>/dev/null |
      jq -r --arg m "${marker}" '[.[] | select(.body | startswith($m))][0].id // empty' 2>/dev/null || true)"
    if [ -n "${existing}" ]; then
      post_url="https://api.github.com/repos/${GH_DEPLOYMENT_REPO}/comments/${existing}"
    fi
  fi

  local method="POST"
  [ -n "${existing}" ] && method="PATCH"
  jq -Rs '{body: .}' < "${body_file}" |
    _gh_deployment_api -X "${method}" "${post_url}" -d @- >/dev/null \
    && echo "[gh-deploy] deploy summary comment ${method} ok (pr=${pr:-none})" >&2 \
    || echo "[gh-deploy] deploy summary comment failed (continuing — lines above carry the links)" >&2
  return 0
}
