import { createBouncer } from "@somewhatintelligent/bouncer";
import { platformConfig } from "@si/config";

// Thin shim — routing/proxy/session/envelope logic all lives in the
// package now (near-verbatim extraction of this worker's prior src/{proxy,
// routes,session,envelope,index}.ts). Routes come from wrangler.jsonc
// `vars.ROUTES`; upstream bindings (GUESTLIST, IDENTITY, STORE, SITE) come
// from wrangler.jsonc `services`. cookiePrefix MUST exactly match
// guestlist's own `cookiePrefix` config (both source from
// platformConfig.cookies.prefix) — a mismatch would make the package's
// session resolver's cookie-presence fast path silently skip the RPC and
// treat every request as anonymous.
//
// Envelope scope (exec-plan 0004 open decision 8, RESOLVED): the customer
// envelope is minted per-(host, session), BEFORE route matching, and the
// same envelope is stamped on whichever upstream the router picks — it is
// NOT per-(host,upstream) or per-mount. Evidence: the package's index.ts
// calls getStamper + stamp(request) ahead of matchRoute and passes that one
// envelope to stampUpstreamHeaders for every dispatch; the stamper's only
// request-derived inputs are the routing host (resolveRoutingHost) and the
// session cookie via the GUESTLIST RPC. Consequence: requests arriving on
// the `/api/store` mount carry the same customer session envelope as `/api`
// today — Store resolves the buyer through the standard envelope +
// guestlist session path (T12) with no bouncer changes.
export default createBouncer({
  cookiePrefix: platformConfig.cookies.prefix,
  serviceName: "bouncer",
});
