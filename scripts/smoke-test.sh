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
# (bouncer). A release that ships ONLY a leaf worker (e.g. promoter or roadie,
# with bouncer unchanged) is smoke-tested via the UN-redeployed router,
# so this proves the router still answers <500 but gives near-zero signal on the
# freshly-shipped leaf itself. That is a conscious acceptance per Spec 03 §B.3.2
# ("simplest: always run the existing apex smoke test; it exercises the router
# path end-to-end"), not an oversight — a per-worker health surface would be the
# richer check if leaf-only releases ever need real post-deploy coverage.
set -euo pipefail

url="${1:?usage: smoke-test.sh <url>}"
echo "Smoke-testing ${url} ..."
for attempt in 1 2 3 4 5; do
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "${url}/" || echo 000)"
  if [ "$code" != "000" ] && [ "$code" -lt 500 ]; then
    echo "smoke OK (HTTP ${code})"
    exit 0
  fi
  echo "attempt ${attempt}: HTTP ${code} — retrying in 5s"
  sleep 5
done
echo "SMOKE TEST FAILED: ${url} never returned <500" >&2
exit 1
