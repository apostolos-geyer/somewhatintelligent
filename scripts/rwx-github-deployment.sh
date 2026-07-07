# shellcheck shell=bash
#
# Best-effort GitHub Deployments reporting for RWX deploys (.rwx/deploy.yml,
# shared by .rwx/ci.yml's staging lane and .rwx/release.yml's production lane).
# RWX only reports commit *statuses* (checks) to GitHub — it never creates
# GitHub *Deployments*, so the Cloudflare deploy never showed up under the
# repo's "Deployments" / Environments timeline. This is sourced by deploy.yml's
# `migrate` and `deploy` tasks to create that deployment record and move it
# through in_progress -> success/failure via the GitHub REST API.
# GH_DEPLOYMENT_ENV/GH_DEPLOYMENT_URL are set per-call by deploy.yml's
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
# statuses/checks scopes are NOT enough). GH_TOKEN is empty on local `rwx run`
# (cli trigger), in which case every function below cleanly no-ops.

GH_DEPLOYMENT_REPO="${GH_DEPLOYMENT_REPO:-apostolos-geyer/somewhatintelligent}"
GH_DEPLOYMENT_ENV="${GH_DEPLOYMENT_ENV:-staging}"
# Public entry point for the staging environment (the single-host apex). The
# domain's source of truth is packages/config/src/deploy.ts (baseDomain); the
# bouncer router serves the whole platform at staging.<baseDomain>.
GH_DEPLOYMENT_URL="${GH_DEPLOYMENT_URL:-https://staging.somewhatintelligent.ca}"

_gh_deployment_api() {
  curl -fsS \
    -H "Authorization: Bearer ${GH_TOKEN:-}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

# gh_deployment_create <ref>
# Creates the deployment and exports GH_DEPLOYMENT_ID for the rest of this shell,
# and (if running under RWX) writes it to $RWX_ENV/GH_DEPLOYMENT_ID so downstream
# `use` tasks inherit it.
gh_deployment_create() {
  local ref="$1" id
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
