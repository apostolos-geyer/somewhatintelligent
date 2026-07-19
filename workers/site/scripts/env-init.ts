#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s).
import { resolve, dirname } from "node:path";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/site";

// ENVIRONMENT=development mirrors the other workers' local-dev gate; SITE_URL
// is the local astro origin (checkout return base, RFC-0001 env table).
const devVars = `# Local dev against the staging top-level wrangler config.
ENVIRONMENT=development
SITE_URL=http://127.0.0.1:4321
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
