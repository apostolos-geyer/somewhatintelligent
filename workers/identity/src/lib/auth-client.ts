import { createGuestlistAuthClient } from "@si/guestlist-service/client/react";

// `baseURL` here is the **app root** the guestlist client will hit — BA's
// handler URL (`${baseURL}/api/auth`) and the eden treaty's typed RPC
// paths (`${baseURL}/users/lookup`, `${baseURL}/api/avatar/...`, etc.)
// are both derived from this single value inside `createGuestlistAuthClient`.
//
// We pass the bare origin (no path) so every request stays same-origin from
// the browser's perspective and lands on `/api/*` at the origin ROOT — same
// host as identity's own `/account` mount, but a sibling path, not a child
// of it (bouncer routes `/api` -> guestlist directly; in local dev-direct,
// `workers/identity/src/routes/api/$.ts` proxies it over the service
// binding instead). In SSR (`window` undefined), `import.meta.env.IDENTITY_URL`
// is identity's own PUBLIC address, which in staging/production is
// `<origin>/account` (bouncer vmf-mounts identity there) — strip that path
// via `new URL(...).origin` so the SSR-side fetch still targets `/api/auth`
// at the root, not `/account/api/auth`.
const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : new URL(import.meta.env.IDENTITY_URL).origin;

export const guestlist = createGuestlistAuthClient({ baseURL });

export const authClient = guestlist.auth;
