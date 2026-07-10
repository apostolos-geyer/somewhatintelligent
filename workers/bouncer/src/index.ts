import { createBouncer } from "@somewhatintelligent/bouncer";
import { platformConfig } from "@si/config";

// Thin shim — routing/proxy/session/envelope logic all lives in the
// package now (near-verbatim extraction of this worker's prior src/{proxy,
// routes,session,envelope,index}.ts). Routes come from wrangler.jsonc
// `vars.ROUTES`; upstream bindings (GUESTLIST, IDENTITY, STORE) come from
// wrangler.jsonc `services`. cookiePrefix MUST exactly match guestlist's own
// `cookiePrefix` config (both source from platformConfig.cookies.prefix) —
// a mismatch would make the package's session resolver's cookie-presence
// fast path silently skip the RPC and treat every request as anonymous.
export default createBouncer({
  cookiePrefix: platformConfig.cookies.prefix,
  serviceName: "bouncer",
});
