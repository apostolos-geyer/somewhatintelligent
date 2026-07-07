/**
 * Canonical type aliases inferred from the platform's auth instance shape.
 *
 * `PlatformAuth` is the return type of `createPlatformAuth` — the union of
 * Better Auth core + every plugin we wire (admin role, 2FA, passkey, etc.).
 * Consumers (bouncer/identity) import the session/user types from here so
 * they don't need to depend on guestlist's local auth.ts.
 */
import type { createPlatformAuth } from "./server";

export type PlatformAuth = ReturnType<typeof createPlatformAuth>;
export type PlatformSessionData = PlatformAuth["$Infer"]["Session"]["session"];
export type PlatformUser = PlatformAuth["$Infer"]["Session"]["user"];
export interface PlatformSession {
  session: PlatformSessionData;
  user: PlatformUser;
}
