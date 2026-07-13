// Vault-local helpers for canonical logging. The withCanonicalLog scope
// itself is opened by `@instrumented` on the Vault class (see ./index.ts).
//
// `request_id` is NEVER minted — always taken from `meta.requestId`, which
// the consumer Worker sets at its entry point and propagates unchanged.
import type { WorkerEntrypoint } from "cloudflare:workers";
import type { CallMeta } from "./meta";
import type { CtxProps, VaultEnv } from "./vault-env";

export interface VaultInstance {
  ctx: WorkerEntrypoint<VaultEnv>["ctx"];
  env: VaultEnv;
}

export function readCallerApp(vault: VaultInstance, meta?: CallMeta): string {
  // Primary: binding's `props.callerApp`, verified at deploy time. This is
  // authoritative because the consumer's wrangler.jsonc is pinned.
  const props = vault.ctx.props as CtxProps | undefined;
  if (props && typeof props.callerApp === "string" && props.callerApp.length > 0) {
    return props.callerApp;
  }
  // Fallback: `meta.callerApp` from the per-call payload. Exists because the
  // `@cloudflare/vite-plugin` dev path drops `props` on the binding when
  // converting wrangler config → miniflare options (wrangler 4.83.0).
  if (meta && typeof meta.callerApp === "string" && meta.callerApp.length > 0) {
    return meta.callerApp;
  }
  // Deployment-misconfiguration assertion: fail loudly on first call rather
  // than quietly emitting audit rows with a missing caller_app.
  throw new Error(
    "VAULT binding missing props.callerApp — check consumer wrangler.jsonc (and meta.callerApp for dev)",
  );
}
