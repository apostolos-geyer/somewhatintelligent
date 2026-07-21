#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s). Migrations live in
// `bun run db:migrate:local`. Split per docs/ops/05.
import { resolve, dirname } from "node:path";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/publisher";

const devVars = `# Local dev against the staging top-level wrangler config.
ENVIRONMENT=development
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
