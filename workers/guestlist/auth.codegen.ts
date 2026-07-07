/**
 * Thin wrapper for running Better Auth CLI in Node.js.
 * The real auth config lives in src/auth.ts but depends on cloudflare:workers
 * (via src/index.ts), which crashes outside the Workers runtime.
 *
 * Usage:
 *   BETTER_AUTH_URL=https://guestlist.platform.example BETTER_AUTH_SECRET=dummy \
 *     bunx auth@latest generate --config auth.codegen.ts --output src/schema.ts
 */
import { createGuestlistAuth } from "./src/auth-config";

export const auth = createGuestlistAuth(process.env as any, {} as any);
