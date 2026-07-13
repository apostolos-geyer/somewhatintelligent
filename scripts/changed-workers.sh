#!/usr/bin/env bash
#
# Map a git-diff file list (stdin, one path per line) to the workers whose
# DEPLOYED BUNDLES it affects (stdout, one worker per line, canonical deploy
# order). Shared by .rwx/preview.yml (per-PR previews) and
# .rwx/promote-staging.yml (subset staging deploys).
#
# Ownership rules mirror .rwx/ci.yml's gate-filter reasoning:
#   - workers/<w>/**                  -> that worker
#   - workers/{guestlist,promoter,roadie}/**
#                                     -> ALL platform workers (they export RPC
#                                        clients/types consumed across the
#                                        workspace — same reason they sit in the
#                                        shared gate filter)
#   - packages/**, bun.lock, root package.json/vite.config.ts/bunfig.toml
#                                     -> ALL platform workers
#   - inbox/**                        -> no workers. The vendored inbox app is
#                                        standalone (own lockfile, no workspace
#                                        deps) and deploys MANUALLY
#                                        (`cd inbox && bun run deploy`), outside
#                                        RWX entirely — by owner decision it has
#                                        no CI/CD lane and no release-please
#                                        component.
#   - docs/**, .rwx/**, e2e/**, .captain/**, .githooks/**, scripts/**, *.md
#                                     -> no workers (CI/dev/docs surfaces; the
#                                        gate still runs, deploys don't need to)
#   - anything else                   -> ALL platform workers (conservative
#                                        default)
#
# Self-test: scripts/changed-workers.sh --self-test
set -euo pipefail

# Canonical platform deploy order (bouncer LAST — it binds guestlist,
# identity, and store, which must already exist; see .rwx/deploy.yml).
ORDER=(promoter roadie vault guestlist identity store bouncer)

classify() {
  local all=0
  declare -A hit=()
  while IFS= read -r f; do
    [ -z "$f" ] && continue
    case "$f" in
      workers/guestlist/* | workers/promoter/* | workers/roadie/*) all=1 ;;
      workers/*)
        w="${f#workers/}"
        w="${w%%/*}"
        hit["$w"]=1
        ;;
      inbox/*) : ;; # manual-deploy standalone app — never triggers a lane
      packages/* | bun.lock | package.json | vite.config.ts | bunfig.toml) all=1 ;;
      docs/* | .rwx/* | e2e/* | .captain/* | .githooks/* | scripts/* | *.md | .gitignore) : ;;
      *) all=1 ;;
    esac
  done
  for w in "${ORDER[@]}"; do
    if [ "$all" = "1" ] || [ "${hit[$w]:-}" = "1" ]; then echo "$w"; fi
  done
}

if [ "${1:-}" = "--self-test" ]; then
  fail=0
  t() { # t <name> <expected-space-joined> <input...>
    local name="$1" expected="$2"
    shift 2
    got="$(printf '%s\n' "$@" | classify | tr '\n' ' ' | sed 's/ $//')"
    if [ "$got" != "$expected" ]; then
      echo "FAIL $name: expected [$expected] got [$got]" >&2
      fail=1
    else
      echo "ok   $name"
    fi
  }
  t worker-only "identity" workers/identity/src/router.tsx workers/identity/src/styles.css
  t rpc-worker-fans-out "promoter roadie vault guestlist identity store bouncer" workers/guestlist/src/index.ts
  t shared-package "promoter roadie vault guestlist identity store bouncer" packages/ui/src/button.tsx
  t docs-only "" docs/onboarding.md .rwx/ci.yml README.md
  t mixed "identity bouncer" workers/identity/src/a.ts workers/bouncer/src/b.ts docs/x.md
  t lockfile "promoter roadie vault guestlist identity store bouncer" bun.lock
  t store-only "store" workers/store/src/index.ts
  t inbox-is-a-no-op "" inbox/app/root.tsx inbox/package.json
  t inbox-plus-worker "identity" inbox/app/root.tsx workers/identity/src/a.ts
  exit "$fail"
fi

classify
