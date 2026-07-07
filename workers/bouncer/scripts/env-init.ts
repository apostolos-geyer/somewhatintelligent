#!/usr/bin/env bun
import { resolve, dirname } from "node:path";
import {
  LOCAL_IDENTITY_URL,
  LOCAL_BNC_ATT_PRIV,
  LOCAL_BNC_ATT_KID,
  writeDevVarsIfMissing,
} from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/bouncer";

// Bouncer holds the platform's single Ed25519 attestation signing key
// (BNC_ATT_PRIV) — used to sign x-platform-att envelopes on every forwarded
// request. Apps verify with the public key set committed in
// packages/config/src/bouncer-attestation.ts. Bouncer does NOT hold
// BETTER_AUTH_SECRET; session verification is delegated to guestlist over the
// service binding.
const devVars = `ENVIRONMENT=development
IDENTITY_URL=${LOCAL_IDENTITY_URL}
BNC_ATT_KID=${LOCAL_BNC_ATT_KID}
BNC_ATT_PRIV="${LOCAL_BNC_ATT_PRIV.replace(/\n/g, "\\n")}"
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
