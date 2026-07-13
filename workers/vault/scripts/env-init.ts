#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s). No local migrations —
// vault's schema lives in per-tenant Durable Object SQLite, applied by the
// DO itself on first touch.
import { dirname, resolve } from "node:path";
import {
  LOCAL_VAULT_KEK_V1,
  LOCAL_VAULT_STATE_HMAC,
  writeDevVarsIfMissing,
} from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/vault";

const devVars = `ENVIRONMENT=development
# Well-known dev key material (scripts/dev-config.ts). Local-only: signs and
# wraps nothing that leaves the machine. Staging/production values are
# provisioned via \`bun run secrets\` (packages/secrets).
VAULT_KEK_V1=${LOCAL_VAULT_KEK_V1}
VAULT_STATE_HMAC=${LOCAL_VAULT_STATE_HMAC}
# GitHub OAuth app for the "github" destination — optional until onboarded.
VAULT_GITHUB_CLIENT_ID=
VAULT_GITHUB_CLIENT_SECRET=
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
