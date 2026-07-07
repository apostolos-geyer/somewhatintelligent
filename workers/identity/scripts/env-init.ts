#!/usr/bin/env bun
import { resolve, dirname } from "node:path";
import {
  PLATFORM_DEV_VARS,
  LOCAL_BNC_ATT_KID,
  LOCAL_BNC_ATT_PRIV,
  writeDevVarsIfMissing,
} from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/identity";

// identity runs dev-direct on `identity.somewhatintelligent.localhost`: bouncer is not
// in the path, so the app self-mints attestation envelopes with the well-known
// dev key via kit's dev-envelope stamper (needs BNC_ATT_KID + BNC_ATT_PRIV;
// src/lib/platform.ts reads both). wrangler.jsonc's top level is staging, so
// the seeded .dev.vars must carry them, or principal-gated server fns 307-loop.
// SAFE: kit's stamper is a hard no-op outside ENVIRONMENT=development.
const devVars = `${PLATFORM_DEV_VARS}BNC_ATT_KID=${LOCAL_BNC_ATT_KID}
BNC_ATT_PRIV="${LOCAL_BNC_ATT_PRIV.replace(/\n/g, "\\n")}"
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
