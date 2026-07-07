/**
 * Typed `env` re-export. The single cast against
 * `cloudflare:workers`'s `env` lives here; rest of the source reads
 * `GuestlistEnv` directly.
 *
 * `Cloudflare.Env` (the global type of `cfEnv`) is compilation-unit scoped
 * and may diverge from `GuestlistEnv` when another package walks our
 * source — see `guestlist-env.ts` for the rationale. The cast at this
 * boundary is the runtime-truth assertion: wrangler wired these bindings,
 * we know the shape, retype it explicitly so the rest of the source is
 * self-contained.
 */
import { env as cfEnv } from "cloudflare:workers";
import type { GuestlistEnv } from "./guestlist-env";

// `cfEnv`'s static type is the global `Cloudflare.Env`, which differs per
// compilation unit (every worker has its own `worker-configuration.d.ts`).
// When another package walks our source via a type import, TS resolves
// `cfEnv` against the WALKER's `Cloudflare.Env` — structurally
// incompatible with `GuestlistEnv`, so TS demands the `unknown` bridge.
// This is the ONE place in the service where this cast lives.
export const env: GuestlistEnv = cfEnv as unknown as GuestlistEnv;
