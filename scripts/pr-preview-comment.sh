#!/usr/bin/env bash
#
# Upsert the sticky per-PR preview comment (docs/ops/04 §4.3). One comment per
# PR, found by marker and edited in place so pushes update rather than spam.
#
# Usage: GH_TOKEN=… pr-preview-comment.sh <pr-number> <body-file>
#
# Degradation is DOCUMENTED, not silent: if the token can't comment (403 — the
# RWX github.token may lack issues:write), we print the body + a pointer to the
# RWX run links panel (the preview URLs are also emitted via $RWX_LINKS) and
# exit 0. Every other API failure is fatal.
set -euo pipefail

pr="${1:?pr number required}"
body_file="${2:?body file required}"
repo="apostolos-geyer/greenroom"
marker="<!-- greenroom-previews -->"

api() { gh api "$@" 2>&1; }

existing_id="$(gh api "repos/${repo}/issues/${pr}/comments" --paginate \
  --jq "[.[] | select(.body | startswith(\"${marker}\"))][0].id // empty" || true)"

set +e
if [ -n "${existing_id}" ]; then
  out="$(gh api -X PATCH "repos/${repo}/issues/comments/${existing_id}" -F body=@"${body_file}" 2>&1)"
else
  out="$(gh api -X POST "repos/${repo}/issues/${pr}/comments" -F body=@"${body_file}" 2>&1)"
fi
rc=$?
set -e

if [ $rc -ne 0 ]; then
  if grep -q "403\|Resource not accessible" <<<"${out}"; then
    echo "pr-preview-comment: token cannot comment (403) — preview URLs remain visible in the RWX run's links panel." >&2
    echo "Grant the rwx-automation-greenroom app issues:write + expose its token in the greenroom_preview vault to enable PR comments." >&2
    cat "${body_file}"
    exit 0
  fi
  echo "pr-preview-comment: GitHub API error:" >&2
  echo "${out}" >&2
  exit 1
fi
echo "pr-preview-comment: upserted comment on PR #${pr}"
