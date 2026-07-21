#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s). Migrations live in
// `bun run db:migrate:local`. Split per docs/ops/05.
import { resolve, dirname } from "node:path";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/roadie";

// Local dev round-trips blobs entirely offline: `put` writes into the
// miniflare R2 sim and `getReadUrl` points browsers at roadie's own
// `/__dev/blob/<id>` route (served on the portless HTTPS origin below, so an
// HTTPS page's redirect isn't blocked as mixed content). ROADIE_PORT still
// shifts the underlying listener — portless auto-detects it. The S3 keys stay
// blank: presigning is a deployed-env concern only.
const devVars = `ENVIRONMENT=development
ROADIE_DEV_ORIGIN=https://roadie.somewhatintelligent.localhost

# R2 access keys — generate from the Cloudflare R2 dashboard
# (R2 → Manage R2 API Tokens) and paste them here. Deployed envs only;
# local reads/writes go through the miniflare R2 sim.
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
