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
// STORE_URL is the store's own dev origin (portless overrides it with the live
// branch-prefixed URL at runtime).
//
// SITE_URL feeds the checkout-session returnUrl (RFC-0001 D11) — the
// Stripe redirect after payment lands on Site's /checkout/return, not the
// headless Store worker. It must be Site's portless hostname: the session
// cookie and store CORS are scoped to *.somewhatintelligent.localhost, so a
// raw-port origin 401s on the return page's status polling.
const devVars = `${PLATFORM_DEV_VARS}STORE_URL=https://store.somewhatintelligent.localhost
SITE_URL=https://site.somewhatintelligent.localhost
BNC_ATT_KID=${LOCAL_BNC_ATT_KID}
BNC_ATT_PRIV="${LOCAL_BNC_ATT_PRIV.replace(/\n/g, "\\n")}"
# Stripe webhook ingestion (/hooks/store) — unset until Stripe onboarding.
# stripeConfigured() needs BOTH or the route returns 503; seed the whsec locally
# from 'stripe listen --print-secret'. Mirrors workers/guestlist/scripts/env-init.ts.
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SIGNING_SECRET=
STRIPE_PUBLISHABLE_KEY=
`;

writeDevVarsIfMissing(`${pkgDir}/.dev.vars`, devVars, label);
