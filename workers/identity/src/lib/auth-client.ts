import { createGuestlistAuthClient } from "@somewhatintelligent/guestlist/client/react";

// `baseURL` here is the **app root** the guestlist client will hit. This
// client derives ONLY better-auth's handler URL (`${baseURL}/api/auth`) from
// this value — it carries no HTTP treaty and no `setAvatar`/`removeAvatar`
// methods. Avatar mutations go through server fns that forward to the
// guestlist WorkerEntrypoint RPC (see @/lib/avatar.functions + avatar-transport).
//
// We pass the bare origin (no path) so every request stays same-origin from
// the browser's perspective and lands on `/api/*` at the origin ROOT — same
// host as identity's own `/account` mount, but a sibling path, not a child
// of it (bouncer routes `/api` -> guestlist directly; in local dev-direct,
// `src/routes/api/$.ts` proxies it over the service binding instead). In SSR
// (`window` undefined), `import.meta.env.IDENTITY_URL`
// is identity's own PUBLIC address, which in staging/production is
// `<origin>/account` (bouncer vmf-mounts identity there) — strip that path
// via `new URL(...).origin` so the SSR-side fetch still targets `/api/auth`
// at the root, not `/account/api/auth`.
const baseURL =
  typeof window !== "undefined"
    ? window.location.origin
    : new URL(import.meta.env.IDENTITY_URL).origin;

export const guestlist = createGuestlistAuthClient({ baseURL });

export const authClient = guestlist;
