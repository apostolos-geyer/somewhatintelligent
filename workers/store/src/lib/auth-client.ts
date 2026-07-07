import { createGuestlistAuthClient } from "@si/guestlist-service/client/react";

// `baseURL` is the app root the guestlist client hits — BA's handler
// (`${baseURL}/api/auth`) and the eden treaty's typed RPC paths derive from it.
// We pass the bare origin (no path) so every request stays same-origin and
// lands on `/api/*` at the origin ROOT — bouncer routes `/api` → guestlist
// directly (a sibling of the store's `/shop` mount, not a child of it). In SSR
// (`window` undefined), `import.meta.env.IDENTITY_URL` is identity's PUBLIC
// address, which in staging/production is `<origin>/account`; strip that path
// via `new URL(...).origin` so the SSR-side fetch targets `/api/auth` at the
// root. Mirrors workers/identity/src/lib/auth-client.ts.
const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : new URL(import.meta.env.IDENTITY_URL).origin;

export const guestlist = createGuestlistAuthClient({ baseURL });

export const authClient = guestlist.auth;
