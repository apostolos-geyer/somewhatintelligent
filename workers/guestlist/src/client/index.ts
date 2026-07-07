export {
  createGuestlistClient,
  type GuestlistClient,
  type GuestlistClientOptions,
  type GuestlistCookieAdapter,
} from "./guestlist";
// `setAvatar` / `removeAvatar` aren't re-exported here on purpose — the
// canonical browser API is via the client object returned by
// `createGuestlistAuthClient` (see ./react). Keeping the surface small means
// there's exactly one shape to learn: `guestlist.setAvatar(blob, opts)`.
export { AvatarError, type AvatarContentType } from "./avatar";
