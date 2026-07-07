import { createGuestlistAuthClient } from "@greenroom/guestlist-service/client/react";

// `baseURL` here is the **app root** the guestlist client will hit — BA's
// handler URL (`${baseURL}/api/auth`) and the eden treaty's typed RPC
// paths (`${baseURL}/users/lookup`, `${baseURL}/api/avatar/...`, etc.)
// are both derived from this single value inside `createGuestlistAuthClient`.
//
// We pass sprout's own origin so every request stays same-origin from the
// browser's perspective; `workers/sprout/src/routes/api/$.ts` then proxies
// `/api/*` to guestlist over the service binding. Cookies attach
// automatically (no CORS preflight, no cross-subdomain cookie shenanigans).
// In SSR (`window` undefined), fall back to the wrangler-baked SPROUT_URL.
const baseURL = typeof window !== "undefined" ? window.location.origin : import.meta.env.SPROUT_URL;

export const guestlist = createGuestlistAuthClient({ baseURL });

export const authClient = guestlist.auth;
