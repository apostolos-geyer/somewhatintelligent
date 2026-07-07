// Roadie-local helpers for canonical logging. The withCanonicalLog scope
// itself is opened by `@instrumented` on the Roadie class (see ./index.ts);
// this module now hosts only Roadie-specific concerns:
//
//   - `readCallerApp` resolves caller_app from the binding's
//     `ctx.props.callerApp` (deploy-pinned), with a `meta.callerApp`
//     fallback for the `@cloudflare/vite-plugin` dev path that drops
//     `props` when converting wrangler config → miniflare options.
//   - `RoadieInstance` is the narrow `{ctx, env}` view used by helpers
//     co-located under src/methods/.
//
// `request_id` is NEVER minted — always taken from `meta.requestId`, which
// the consumer Worker sets from `cf-request-id` at its entry point and
// propagates unchanged.
import type { WorkerEntrypoint } from "cloudflare:workers";
import type { CallMeta } from "./meta";
import type { CtxProps, RoadieEnv } from "./roadie-env";

export interface RoadieInstance {
  ctx: WorkerEntrypoint<RoadieEnv>["ctx"];
  env: RoadieEnv;
}

export function readCallerApp(roadie: RoadieInstance, meta?: CallMeta): string {
  // Primary: binding's `props.callerApp`, verified at deploy time. This is
  // authoritative because the consumer's wrangler.jsonc is pinned.
  const props = roadie.ctx.props as CtxProps | undefined;
  if (props && typeof props.callerApp === "string" && props.callerApp.length > 0) {
    return props.callerApp;
  }
  // Fallback: `meta.callerApp` from the per-call payload. Exists because the
  // `@cloudflare/vite-plugin` dev path drops `props` on the binding when
  // converting wrangler config → miniflare options (wrangler 4.83.0), leaving
  // `ctx.props` undefined in that path. Consumers include `callerApp` in meta
  // so dev still emits correct caller_app logs + reference rows.
  if (meta && typeof meta.callerApp === "string" && meta.callerApp.length > 0) {
    return meta.callerApp;
  }
  // Deployment-misconfiguration assertion: fail loudly on first call rather
  // than quietly emitting log lines with a missing caller_app.
  throw new Error(
    "ROADIE binding missing props.callerApp — check consumer wrangler.jsonc (and meta.callerApp for dev)",
  );
}
