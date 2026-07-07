// Session reader: re-exported from lib/platform.ts which composes the
// bouncer envelope verifier with guestlist fallback. Kept as a small
// re-export so existing `import { getSession } from "@/lib/session"`
// callers don't have to change.
export { getSession } from "@/lib/platform";
