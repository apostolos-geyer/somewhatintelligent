#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s). Migrations live in
// `bun run db:migrate:local`; demo users/orgs in `bun run seed` (needs the dev
// stack up). Split per docs/ops/05 so CI and fresh clones pay only for what
// they use.
import { resolve, dirname } from "node:path";
import {
  LOCAL_IDENTITY_URL,
  LOCAL_AUTH_DOMAIN,
  LOCAL_BETTER_AUTH_SECRET,
  writeDevVarsIfMissing,
} from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/guestlist";

const devVars = `ENVIRONMENT=development
BETTER_AUTH_URL=${LOCAL_IDENTITY_URL}
IDENTITY_URL=${LOCAL_IDENTITY_URL}
AUTH_DOMAIN=${LOCAL_AUTH_DOMAIN}
EMAIL_FROM=identity@resend.dev
BETTER_AUTH_SECRET=${LOCAL_BETTER_AUTH_SECRET}
# Local-dev OAuth credentials — fill in from your CF/Google/LinkedIn console,
# or copy from another worktree's workers/guestlist/.dev.vars.
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
