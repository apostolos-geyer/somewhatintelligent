#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s). Migrations live in
// `bun run db:migrate:local`; the demo-brand seed in `bun run seed`. Split per
// docs/ops/05.
import { resolve, dirname } from "node:path";
import {
  LOCAL_IDENTITY_URL,
  LOCAL_AUTH_DOMAIN,
  LOCAL_BNC_ATT_PRIV,
  LOCAL_BNC_ATT_KID,
  writeDevVarsIfMissing,
} from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/sprout";

// BNC_ATT_KID/BNC_ATT_PRIV feed kit's dev-only envelope stamper. In dev-direct
// topology bouncer isn't in the path on `*.sproutportal.localhost` requests, so
// the app self-mints with the well-known dev key. SAFE because kit's stamper is
// a hard no-op outside `ENVIRONMENT=development`.
const devVars = `ENVIRONMENT=development
SPROUT_URL=https://sprout.sproutportal.localhost
IDENTITY_URL=${LOCAL_IDENTITY_URL}
AUTH_DOMAIN=${LOCAL_AUTH_DOMAIN}
# Dev uses the canonical subdomain brand addressing (acme.sprout.<dev apex>).
# Required post static-config flip: the wrangler top level is the STAGING
# section (BRAND_RESOLUTION=path), and vite.config.ts overlays THIS file onto
# the client-define vars in dev — without this line dev bundles would bake
# staging's path-mode brand resolution.
BRAND_RESOLUTION=subdomain
BNC_ATT_KID=${LOCAL_BNC_ATT_KID}
BNC_ATT_PRIV="${LOCAL_BNC_ATT_PRIV.replace(/\n/g, "\\n")}"
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
