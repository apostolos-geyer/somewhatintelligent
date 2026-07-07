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
#                                     -> ALL workers (they export RPC clients/
#                                        types consumed across the workspace —
#                                        same reason they sit in the shared
#                                        gate filter)
#   - packages/**, bun.lock, root package.json/vite.config.ts/bunfig.toml
#                                     -> ALL workers
#   - docs/**, .rwx/**, e2e/**, .captain/**, .githooks/**, scripts/**, *.md
#                                     -> no workers (CI/dev/docs surfaces; the
#                                        gate still runs, deploys don't need to)
#   - anything else                   -> ALL workers (conservative default)
#
# Self-test: scripts/changed-workers.sh --self-test
set -euo pipefail

ORDER=(promoter roadie guestlist identity marketing sprout bouncer)

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
  t worker-only "sprout" workers/sprout/src/router.tsx workers/sprout/src/styles.css
  t rpc-worker-fans-out "promoter roadie guestlist identity marketing sprout bouncer" workers/guestlist/src/index.ts
  t shared-package "promoter roadie guestlist identity marketing sprout bouncer" packages/ui/src/button.tsx
  t docs-only "" docs/onboarding.md .rwx/ci.yml README.md
  t mixed "identity marketing" workers/identity/src/a.ts workers/marketing/src/b.ts docs/x.md
  t lockfile "promoter roadie guestlist identity marketing sprout bouncer" bun.lock
  exit "$fail"
fi

classify
