#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s). Migrations live in
// `bun run db:migrate:local`. Split per docs/ops/05.
import { resolve, dirname } from "node:path";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/roadie";

const devVars = `# R2 access keys — generate from the Cloudflare R2 dashboard
# (R2 → Manage R2 API Tokens) and paste them here.
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
