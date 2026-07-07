#!/usr/bin/env bun
import { resolve, dirname } from "node:path";
import {
  PLATFORM_DEV_VARS,
  LOCAL_BNC_ATT_KID,
  LOCAL_BNC_ATT_PRIV,
  writeDevVarsIfMissing,
} from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/store";

// The store runs dev-direct on `store.somewhatintelligent.localhost` (bouncer is not in
// the path locally), so — like identity — it self-mints attestation envelopes
// with the well-known dev key via kit's dev-envelope stamper (BNC_ATT_KID +
// BNC_ATT_PRIV; src/lib/platform.ts reads both). SAFE: the stamper is a hard
// no-op outside ENVIRONMENT=development.
//
// PUBLIC_BASE="/" locally: dev-direct has no `/shop` mount, so the client
// router basepath resolves to root. Staging/production set PUBLIC_BASE="/shop"
// as a wrangler var (see wrangler.jsonc).
//
// STORE_URL is the store's own dev origin (portless overrides it with the live
// branch-prefixed URL at runtime via PORTLESS_URL in vite.config).
const devVars = `${PLATFORM_DEV_VARS}STORE_URL=https://store.somewhatintelligent.localhost
PUBLIC_BASE=/
BNC_ATT_KID=${LOCAL_BNC_ATT_KID}
BNC_ATT_PRIV="${LOCAL_BNC_ATT_PRIV.replace(/\n/g, "\\n")}"
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
