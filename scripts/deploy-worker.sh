#!/usr/bin/env bash
#
# Single source of truth for the platform's per-worker migrate + deploy, shared by
# every RWX deploy lane:
#   - .rwx/deploy.yml            fleet -> staging (ci.yml embedded run)
#   - .rwx/release-please.yml    released subset -> production (folded-in deploy)
#   - .rwx/release.yml           single-worker re-ship / rollback -> production
# Keeping the migrate-before-code invariant and the marketing-under-npm quirk in
# ONE place is the whole point: a fix here lands in all three callers at once,
# instead of having to be replicated by hand (the drift hazard .rwx/deploy.yml's
# header was written to eliminate).
#
# Usage — every subcommand takes <worker> <env>:
#   deploy-worker.sh migrate <worker> <env>   run db:migrate:<env> if the worker
#                                             ships one (D1-backed workers only);
#                                             a migration FAILURE is fatal.
#   deploy-worker.sh deploy  <worker> <env>   deploy the worker's code.
#   deploy-worker.sh ship    <worker> <env>   migrate (if any) THEN deploy — the
#                                             atomic per-worker op the two
#                                             production lanes use.
#
# The canonical fleet ORDER (bouncer LAST) and the error-10143 binding-existence
# history that dictates it live in .rwx/deploy.yml's `deploy` task; the CALLERS
# own the order, this script owns the per-worker mechanics.
set -euo pipefail

cmd="${1:?usage: deploy-worker.sh <migrate|deploy|ship> <worker> <env>}"
worker="${2:?worker name required}"
env="${3:?env (staging|production) required}"

case "$worker" in
  promoter | roadie | guestlist | identity | store | bouncer) : ;;
  *)
    echo "deploy-worker: unknown worker '$worker'" >&2
    exit 1
    ;;
esac
case "$env" in
  staging | production) : ;;
  *)
    echo "deploy-worker: unknown env '$env'" >&2
    exit 1
    ;;
esac

# NOTE: the vendored inbox app (inbox/, worker `agentic-inbox-si` at
# mail.somewhatintelligent.ca) is deliberately NOT a valid worker here — it
# deploys manually (`cd inbox && bun run deploy`), outside RWX, by owner
# decision. No lane calls this script for it.

migrate_worker() {
  # D1 migration BEFORE code, so a freshly-deployed worker never reads a schema
  # the database doesn't have yet. Only D1-backed workers ship this script; run
  # it only when present, and DO NOT swallow a migration failure (no `|| true`) —
  # a failed migration must fail the deploy.
  if jq -e ".scripts[\"db:migrate:${env}\"]" "workers/${worker}/package.json" >/dev/null; then
    (cd "workers/${worker}" && bun run "db:migrate:${env}")
  fi
}

deploy_worker() {
  # Ship-time version stamping for /__version (@si/kit/version): inject the
  # worker's package.json version + the git short sha as plain worker vars.
  # bun appends extra args to the END of the script line, which in every
  # worker's deploy:<env> script is the `wrangler deploy` invocation (identity
  # included — its build step is chained BEFORE the deploy with `&&`).
  # Fallbacks keep manual `bun run deploy:<env>` working: the endpoint then
  # reports the kit defaults instead of failing.
  local version commit
  version="$(jq -r '.version // "0.0.0"' "workers/${worker}/package.json" 2>/dev/null || echo "0.0.0")"
  commit="$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")"
  (cd "workers/${worker}" && bun run "deploy:${env}"     --var "WORKER_VERSION:${version}" --var "WORKER_COMMIT:${commit}")
}

case "$cmd" in
  migrate) migrate_worker ;;
  deploy) deploy_worker ;;
  ship)
    migrate_worker
    deploy_worker
    ;;
  *)
    echo "deploy-worker: unknown subcommand '$cmd'" >&2
    exit 1
    ;;
esac
