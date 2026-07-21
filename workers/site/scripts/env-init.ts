#!/usr/bin/env bun
// .dev.vars seeding ONLY (idempotent, offline, <1s).
import { fileURLToPath } from "node:url";
import { writeDevVarsIfMissing } from "../../../scripts/dev-config";

// import.meta.url (not Bun's import.meta.path): this file sits inside the
// Astro tsconfig project, whose ImportMeta has no Bun extensions.
const pkgDir = fileURLToPath(new URL("..", import.meta.url));
const label = "workers/site";

// ENVIRONMENT=development mirrors the other workers' local-dev gate; SITE_URL
// is the local astro origin (portless, so Site shares a site with store for the
// SameSite=Lax session cookie). PREVIEW_SIGNING_SECRET is the shared HMAC secret
// for Operator draft preview (exec-plan 0004 T23) — the SAME fixed dev value
// seeded into operator/.dev.vars. STORE_API_BASE is the dev-only store hostname
// the browser bundle reads (astro.config.mjs inlines it on the dev command);
// deployed bundles use the same-origin `/api/store` bouncer mount instead.
const devVars = `# Local dev against the staging top-level wrangler config.
ENVIRONMENT=development
SITE_URL=https://site.somewhatintelligent.localhost
STORE_API_BASE=https://store.somewhatintelligent.localhost/api/store
PREVIEW_SIGNING_SECRET=dev-preview-secret
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
