#!/usr/bin/env bash
set -euo pipefail

# Decrypts a dotenvx-encrypted env file and pushes each key as a
# Cloudflare Workers secret via `wrangler secret put`.
#
# Usage:
#   ./scripts/sync-secrets.sh <env-file> [wrangler-env]
#
# Examples:
#   ./scripts/sync-secrets.sh ../../workers/guestlist/.env.preview
#   ./scripts/sync-secrets.sh ../../workers/guestlist/.env.production production

ENV_FILE="${1:?Usage: sync-secrets.sh <env-file> [wrangler-env]}"
WRANGLER_ENV="${2:-}"

ENV_FILE="$(cd "$(dirname "$ENV_FILE")" && pwd)/$(basename "$ENV_FILE")"
ENV_DIR="$(dirname "$ENV_FILE")"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "error: $ENV_FILE not found" >&2
  exit 1
fi

WRANGLER_ENV_FLAG=""
if [[ -n "$WRANGLER_ENV" ]]; then
  WRANGLER_ENV_FLAG="--env $WRANGLER_ENV"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Decrypting $ENV_FILE → wrangler secrets ${WRANGLER_ENV:+(env: $WRANGLER_ENV)}"

# Run dotenvx from the env file's directory so .env.keys is found,
# run wrangler from the guestlist service directory so wrangler.jsonc is found.
(cd "$ENV_DIR" && vp dlx @dotenvx/dotenvx decrypt -f "$ENV_FILE" --stdout) | while IFS= read -r line; do
  [[ -z "$line" || "$line" == \#* || "$line" == DOTENV_* ]] && continue

  key="${line%%=*}"
  value="${line#*=}"
  value="${value#\"}"
  value="${value%\"}"

  echo "  → $key"
  (cd "$SCRIPT_DIR" && echo "$value" | vp exec wrangler secret put "$key" $WRANGLER_ENV_FLAG)
done

echo "Done."
