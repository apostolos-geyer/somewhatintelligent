#!/usr/bin/env bash
#
# Emit the per-worker `versions upload` RWX dynamic tasks + the sticky
# PR-comment task (docs/ops/04 §4.2–4.3). Runs inside .rwx/preview.yml's
# `generate-uploads` task; checked in (not inlined in YAML) so the
# YAML-in-heredoc nesting is testable: bash scripts/generate-preview-tasks.sh
# with CHANGED/PR/SHA/OUT set writes the task file locally for inspection.
#
# Inputs (env): CHANGED  space-joined affected workers (may be empty)
#               PR       pull request number
#               SHA      the PR head sha the uploads are tagged with
#               OUT      dynamic-tasks dir (RWX passes $RWX_DYNAMIC_TASKS)
set -euo pipefail

CHANGED="${CHANGED:-}"
PR="${PR:?PR number required}"
SHA="${SHA:?head sha required}"
OUT="${OUT:?output dir required}"

if [ -z "${CHANGED}" ]; then
  echo "no affected workers — no preview tasks generated"
  exit 0
fi
for w in ${CHANGED}; do
  case "$w" in
    promoter | roadie | guestlist | identity | marketing | sprout | bouncer) : ;;
    *) echo "generate-preview-tasks: refusing unknown worker '$w'" >&2; exit 1 ;;
  esac
done

file="${OUT}/uploads.yml"
keys=()

for w in ${CHANGED}; do
  keys+=("upload-${w}")
  # Build-step apps mirror the build half of their deploy:staging script:
  # `GREENROOM_BUILD=1 vp run build` — build is a VP TASK, not a package.json
  # script (plain `bun run build`/`npm run build` fail with "Script not
  # found"; the first live preview run proved it). GREENROOM_BUILD=1 keeps
  # CI-seeded .dev.vars out of the bundle (docs/ops/02).
  case "$w" in
    identity | sprout | marketing) build="(cd workers/${w} && GREENROOM_BUILD=1 bunx vp run build)" ;;
    *) build=":" ;;
  esac
  cat >> "${file}" <<TASK
- key: upload-${w}
  use: [install, node]
  cache: false
  timeout: 15m
  env:
    CLOUDFLARE_API_TOKEN:
      value: \${{ vaults.greenroom_preview.secrets.CLOUDFLARE_API_TOKEN_PREVIEW }}
      cache-key: excluded
  run: |
    set -euo pipefail
    ${build}
    cd workers/${w}
    export WRANGLER_OUTPUT_FILE_PATH=/tmp/wr-${w}.ndjson
    bunx wrangler versions upload --tag "pr-${PR}-${SHA}" --preview-alias "pr-${PR}" --message "PR #${PR}" | tee /tmp/upload-${w}.log
    VID="\$(jq -r 'select(.type == "version-upload") | .version_id // empty' /tmp/wr-${w}.ndjson | tail -1)"
    # Stable per-PR alias first, per-version URL as fallback (fields verified
    # against a real upload's ndjson: version_id / preview_url / preview_alias_url).
    URL="\$(jq -r 'select(.type == "version-upload") | .preview_alias_url // .preview_url // empty' /tmp/wr-${w}.ndjson | tail -1)"
    if [ -z "\${VID}" ]; then
      echo "FATAL: no version id in wrangler output for ${w} — upload failed (see log above)" >&2
      exit 1
    fi
    printf '%s\n' "\${VID}" > "\$RWX_VALUES/version-id"
    if [ -n "\${URL}" ]; then
      printf '%s\n' "\${URL}" > "\$RWX_VALUES/preview-url"
      printf '%s\n' "\${URL}" | tee "\$RWX_LINKS/preview: ${w}"
    else
      # Cloudflare never issues preview URLs for Durable Object workers
      # (documented limitation — sprout). The version still uploads and is
      # promotable on merge; the PR comment says so instead of a link.
      printf 'none — DO worker; version promotable on merge\n' > "\$RWX_VALUES/preview-url"
      echo "${w}: version \${VID} uploaded; no preview URL (Durable Object worker)"
    fi
TASK
done

# Sticky comment task, after ALL uploads. The table rows reference each upload
# task's output values; RWX resolves tasks.<key>.values.* at run time.
{
  printf -- '- key: pr-comment\n'
  printf '  use: [code, system-packages]\n'
  printf '  after: [%s]\n' "$(IFS=, ; echo "${keys[*]}")"
  printf '  cache: false\n'
  printf '  env:\n'
  printf '    GH_TOKEN:\n'
  printf '      value: ${{ github.token }}\n'
  printf '      cache-key: excluded\n'
  printf '  run: |\n'
  printf '    set -euo pipefail\n'
  printf '    body=/tmp/pr-comment.md\n'
  printf '    {\n'
  printf "      echo '<!-- greenroom-previews -->'\n"
  printf "      echo '### Worker previews (staging bindings)'\n"
  printf "      echo ''\n"
  printf "      echo '| worker | preview | version |'\n"
  printf "      echo '| --- | --- | --- |'\n"
  for w in ${CHANGED}; do
    printf '      echo "| %s | ${{ tasks.upload-%s.values.preview-url }} | \\`${{ tasks.upload-%s.values.version-id }}\\` |"\n' "$w" "$w" "$w"
  done
  printf "      echo ''\n"
  printf "      echo '_Previews validate single workers against **staging** infra: not bouncer-fronted (no cross-subdomain auth), and they call the **deployed** staging siblings, not sibling PR versions. Schema-touching PRs run against the un-migrated staging D1 until merge. Full-journey checks happen on staging after merge._'\n"
  printf '    } > "${body}"\n'
  printf '    bash scripts/pr-preview-comment.sh "%s" "${body}"\n' "${PR}"
} >> "${file}"

echo "generated $((${#keys[@]} + 1)) tasks for: ${CHANGED}"
