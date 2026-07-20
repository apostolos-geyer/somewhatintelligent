#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s). Migrations live in
// `bun run db:migrate:local`. Split per docs/ops/05.
import { resolve, dirname } from "node:path";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/operator";

// Local dev resolves the fixed DEV_OPERATOR actor instead of a Cloudflare
// Access JWT (RFC-0001 D6). ENVIRONMENT must be "development" for the gate to
// honor it; staging/production never fall back to this.
// SITE_PREVIEW_URL points at the local Astro site's /__preview route; the
// PREVIEW_SIGNING_SECRET is the SAME fixed dev value seeded into site/.dev.vars
// so Operator's mint verifies against Site (exec-plan 0004 T23).
const devVars = `# Local-only operator actor, format <sub>:<email> — no Access needed in dev.
ENVIRONMENT=development
DEV_OPERATOR=dev-operator:operator@somewhatintelligent.localhost
SITE_PREVIEW_URL=http://127.0.0.1:4321/__preview
PREVIEW_SIGNING_SECRET=dev-preview-secret
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
