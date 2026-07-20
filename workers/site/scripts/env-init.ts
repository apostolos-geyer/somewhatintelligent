#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s).
import { resolve, dirname } from "node:path";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/site";

// ENVIRONMENT=development mirrors the other workers' local-dev gate; SITE_URL
// is the local astro origin (checkout return base, RFC-0001 env table).
// PREVIEW_SIGNING_SECRET is the shared HMAC secret for Operator draft preview
// (exec-plan 0004 T23) — the SAME fixed dev value seeded into operator/.dev.vars.
const devVars = `# Local dev against the staging top-level wrangler config.
ENVIRONMENT=development
SITE_URL=http://127.0.0.1:4321
PREVIEW_SIGNING_SECRET=dev-preview-secret
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
