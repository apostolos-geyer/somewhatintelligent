import { instrumented } from "@somewhatintelligent/kit/log";
import { handleVersionRequest } from "@somewhatintelligent/kit/version";
import { WorkerEntrypoint } from "cloudflare:workers";
import { readCallerApp, type VaultInstance } from "./log";
import { actorId, validateMeta } from "./meta";
import * as adminM from "./methods/admin";
import * as grantsM from "./methods/grants";
import * as oauthM from "./methods/oauth";
import * as spendM from "./methods/spend";
import { err, type Result } from "./result";
import type { VaultEnv } from "./vault-env";

// The Durable Object class must be exported from the worker's main module.
export { VaultTenantDO } from "./do/tenant-do";
export type { Result } from "./result";
export type { VaultErrorCode } from "./errors";
export type {
  AccessMaterial,
  GrantEnv,
  GrantMeta,
  GrantRef,
  InjectResult,
  InjectSpec,
  OAuthBeginInput,
  OAuthCallbackInput,
  PutInput,
  PutMaterial,
  SpendSelector,
} from "./types";

// Every class-level member on Vault is exposed as RPC by default — there is
// no "private helper" surface at this layer (roadie's ADR-RD-012 stance).
// Implementation helpers live as modular functions under src/methods/; the
// entry worker performs shape validation and tenant→DO routing ONLY — all
// crypto and all token material stay inside the tenant DO.
//
// **RPC visibility requires prototype methods, not instance properties** —
// CF Workers RPC exposes only members declared on the class prototype;
// arrow-fn class fields are invisible (workers/runtime-apis/rpc/visibility).
//
// `@instrumented` wraps every method with a `withCanonicalLog` scope; the
// `onError` config converts thrown exceptions to `err("internal_error", ...)`
// so the wire contract stays pure. These canonical logs (op, outcome,
// latency, caller) are vault's Logpush audit stream (FR-14) — the typed
// event carries codes and metadata, never values.
@instrumented({
  service: "vault",
  resolveContext: ({ args, instance }) => {
    const meta = validateMeta(args[args.length - 1]);
    return {
      requestId: meta.requestId,
      actorKind: meta.actor.kind,
      actorId: actorId(meta.actor),
      callerApp: readCallerApp(instance as VaultInstance, meta),
    };
  },
  deriveOutcome: (ret) => {
    const r = ret as { ok: boolean; error?: string };
    return r.ok ? "ok" : r.error;
  },
  onError: (e) =>
    err("internal_error", e instanceof Error ? e.message : String(e)) as Result<
      unknown,
      "internal_error"
    >,
})
export class Vault extends WorkerEntrypoint<VaultEnv> {
  get #self(): VaultInstance {
    return this as unknown as VaultInstance;
  }

  // ---------- grants ----------
  async put(...args: ArgsOf<typeof grantsM.put>): RetOf<typeof grantsM.put> {
    return grantsM.put(this.#self, ...args);
  }
  async list(...args: ArgsOf<typeof grantsM.list>): RetOf<typeof grantsM.list> {
    return grantsM.list(this.#self, ...args);
  }
  async del(...args: ArgsOf<typeof grantsM.del>): RetOf<typeof grantsM.del> {
    return grantsM.del(this.#self, ...args);
  }
  async setDefault(...args: ArgsOf<typeof grantsM.setDefault>): RetOf<typeof grantsM.setDefault> {
    return grantsM.setDefault(this.#self, ...args);
  }

  // ---------- spend ----------
  async getToken(...args: ArgsOf<typeof spendM.getToken>): RetOf<typeof spendM.getToken> {
    return spendM.getToken(this.#self, ...args);
  }
  async inject(...args: ArgsOf<typeof spendM.inject>): RetOf<typeof spendM.inject> {
    return spendM.inject(this.#self, ...args);
  }

  // ---------- oauth ----------
  async oauthBegin(...args: ArgsOf<typeof oauthM.oauthBegin>): RetOf<typeof oauthM.oauthBegin> {
    return oauthM.oauthBegin(this.#self, ...args);
  }
  async oauthCallback(
    ...args: ArgsOf<typeof oauthM.oauthCallback>
  ): RetOf<typeof oauthM.oauthCallback> {
    return oauthM.oauthCallback(this.#self, ...args);
  }

  // ---------- admin ----------
  async killTenant(...args: ArgsOf<typeof adminM.killTenant>): RetOf<typeof adminM.killTenant> {
    return adminM.killTenant(this.#self, ...args);
  }
  async rotateKek(...args: ArgsOf<typeof adminM.rotateKek>): RetOf<typeof adminM.rotateKek> {
    return adminM.rotateKek(this.#self, ...args);
  }
  async auditRecent(...args: ArgsOf<typeof adminM.auditRecent>): RetOf<typeof adminM.auditRecent> {
    return adminM.auditRecent(this.#self, ...args);
  }
}

// Method-helper modules take `VaultInstance` as their first param; the class
// trampolines drop it so consumers see only the user-facing args. `RetOf`
// folds the `internal_error` shape that `@instrumented`'s `onError` injects
// into every method's wire return, keeping every signature in lockstep.
type ArgsOf<F extends (...args: never[]) => unknown> = F extends (
  self: VaultInstance,
  ...rest: infer R
) => unknown
  ? R
  : never;
type RetOf<F extends (...args: never[]) => unknown> = Promise<
  Awaited<ReturnType<F>> | Result<never, "internal_error">
>;

// Default `fetch`: /__version only — vault has NO public HTTP surface
// (binding-only by scope); consumers reach it exclusively over service
// bindings. No `scheduled`: expiry hygiene runs on per-tenant DO alarms.
export default {
  async fetch(request: Request, env: VaultEnv): Promise<Response> {
    return (
      handleVersionRequest(request, {
        worker: "vault",
        env,
        overrides: { version: env.WORKER_VERSION, commit: env.WORKER_COMMIT },
      }) ?? new Response(null, { status: 404 })
    );
  },
} satisfies ExportedHandler<VaultEnv>;
