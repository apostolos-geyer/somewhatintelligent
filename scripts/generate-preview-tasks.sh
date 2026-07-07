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
    promoter | roadie | guestlist | identity | store | bouncer) : ;;
    *) echo "generate-preview-tasks: refusing unknown worker '$w'" >&2; exit 1 ;;
  esac
done

file="${OUT}/uploads.yml"
keys=()

for w in ${CHANGED}; do
  keys+=("upload-${w}")
  # Build-step apps mirror the build half of their deploy:staging script:
  # `SI_BUILD=1 vp run build`, run via the vp task (no package.json build
  # script exists). SI_BUILD=1 keeps CI-seeded .dev.vars out of the bundle.
  case "$w" in
    identity|store) build="(cd workers/${w} && SI_BUILD=1 bunx vp run build)" ;;
    # guestlist bundles @si/stripe -> src/generated.ts (gitignored codegen);
    # vp's task graph produces it (build dependsOn @si/stripe#codegen) before
    # wrangler bundles here.
    guestlist) build="(cd workers/${w} && bunx vp run build)" ;;
    *) build=":" ;;
  esac
  cat >> "${file}" <<TASK
- key: upload-${w}
  use: [install, node]
  cache: false
  timeout: 15m
  env:
    CLOUDFLARE_API_TOKEN:
      value: \${{ vaults.si_preview.secrets.CLOUDFLARE_API_TOKEN_PREVIEW }}
      cache-key: excluded
  run: |
    set -euo pipefail
    ${build}
    # Store's Stripe queue binding is deploy-time infrastructure, not a useful
    # per-PR preview dependency. Preview uploads run with the intentionally
    # narrow si_preview token (Workers Scripts write, not Queues write) and the
    # queue may not exist until the live Stripe wiring step. Strip the generated
    # Vite deploy config before wrangler versions upload so a store preview
    # can still validate the runnable web surface without requiring queue infra.
    if [ "${w}" = "store" ] && [ -f "workers/store/dist/server/wrangler.json" ]; then
      jq 'del(.queues)' workers/store/dist/server/wrangler.json > /tmp/store-preview-wrangler.json
      mv /tmp/store-preview-wrangler.json workers/store/dist/server/wrangler.json
    fi
    cd workers/${w}
    export WRANGLER_OUTPUT_FILE_PATH=/tmp/wr-${w}.ndjson
    # --var: ship-time version stamping for /__version (mirrors
    # scripts/deploy-worker.sh) so a version PROMOTED on merge reports the
    # version/commit it was built from, not fallbacks. WORKER_COMMIT is the
    # PR head sha this upload is tagged with.
    WVER="\$(jq -r '.version // "0.0.0"' package.json)"
    bunx wrangler versions upload --tag "pr-${PR}-${SHA}" --preview-alias "pr-${PR}" --message "PR #${PR}" --var "WORKER_VERSION:\${WVER}" --var "WORKER_COMMIT:${SHA}" | tee /tmp/upload-${w}.log
    VID="\$(jq -r 'select(.type == "version-upload") | .version_id // empty' /tmp/wr-${w}.ndjson | tail -1)"
    # Prefers the per-PR alias URL, falls back to the per-version URL
    # (ndjson fields: version_id / preview_url / preview_alias_url).
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
      # Cloudflare does not issue preview URLs for Durable Object workers.
      # The version still uploads and is promotable on merge; the PR
      # comment reports that instead of a link.
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
  printf '      value: ${{ vaults.si_deploy.github-apps.rwx-automation-si.token }}\n'
  printf '      cache-key: excluded\n'
  printf '  run: |\n'
  printf '    set -euo pipefail\n'
  printf '    body=/tmp/pr-comment.md\n'
  printf '    {\n'
  printf "      echo '<!-- si-previews -->'\n"
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
