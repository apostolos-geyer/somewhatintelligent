#!/usr/bin/env bash
#
# Post-deploy smoke test, shared by all three RWX deploy lanes (.rwx/deploy.yml,
# .rwx/release-please.yml, .rwx/release.yml). Hit the public bouncer router at
# <url> and require it to answer without a server error: accept any status < 500
# (a 200/301/302/307 to the identity sign-in is a healthy router); FAIL on a 5xx
# or no connection at all (000) — a worker exception / broken binding / unrouted
# deploy. The caller's EXIT trap then reports the deploy as `failure`.
#
# NOTE (leaf-only releases): this only exercises the public apex router
# (bouncer). A release that ships only a leaf worker (e.g. promoter or roadie,
# with bouncer unchanged) is smoke-tested via the unredeployed router, so this
# confirms the router still answers <500 but gives near-zero signal on the
# freshly-shipped leaf itself.
set -euo pipefail

url="${1:?usage: smoke-test.sh <url>}"
echo "Smoke-testing ${url} ..."
for attempt in 1 2 3 4 5; do
  # curl already emits "000" via -w on failure, so `|| true` preserves that
  # value intact for the 1xx-4xx match below.
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${url}/" || true)"
  if [[ "$code" =~ ^[1-4][0-9]{2}$ ]]; then
    echo "smoke OK (HTTP ${code})"
    exit 0
  fi
  echo "attempt ${attempt}: HTTP ${code} — retrying in 5s"
  sleep 5
done
echo "SMOKE TEST FAILED: ${url} never returned <500" >&2
exit 1
