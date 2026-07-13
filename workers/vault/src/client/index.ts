/**
 * Vault consumer SDK. Wraps the `env.VAULT` service binding so apps stop
 * hand-rolling `meta` on every call (same shape as the roadie client).
 *
 *   export const vault = createVaultClient(env.VAULT, {
 *     callerApp: "gateway",
 *     getRequestId: () => extractRequestId(getRequest()),
 *     getActor: resolveActor,
 *   });
 *
 *   await vault.inject({ tenantId, dest: "stripe", label: "sandbox", request });
 *   await vault.getToken({ tenantId, dest: "github" });
 */
import type { Actor } from "@somewhatintelligent/kit/request-context";
import type { Vault } from "../index";

export type { Actor } from "@somewhatintelligent/kit/request-context";
export { err, ok, type Result } from "../result";
export type { VaultErrorCode } from "../errors";
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
} from "../types";

/** Actor at the consumer boundary. Anonymous is folded to a service actor on the way out. */
export type VaultActor = Actor | { kind: "anonymous"; label: string };

export interface VaultClientOpts {
  /** App identifier. Sets `meta.callerApp` and forms the anon-actor service prefix. */
  callerApp: string;
  /** Reads the active request's correlation id. */
  getRequestId: () => string;
  /** Resolves the default actor for calls made without an override. */
  getActor: () => VaultActor | Promise<VaultActor>;
}

type Binding = Service<typeof Vault>;
type Input<K extends keyof Vault> = Vault[K] extends (input: infer I, ...rest: unknown[]) => unknown
  ? I
  : never;

export function createVaultClient(binding: Binding, opts: VaultClientOpts) {
  const buildMeta = async (override: VaultActor | undefined) => {
    const actor = override ?? (await opts.getActor());
    return {
      actor: foldAnonymous(actor, opts.callerApp),
      requestId: opts.getRequestId(),
      callerApp: opts.callerApp,
    };
  };
  return {
    // grants
    put: async (input: Input<"put">, actor?: VaultActor) =>
      binding.put(input, await buildMeta(actor)),
    list: async (input: Input<"list">, actor?: VaultActor) =>
      binding.list(input, await buildMeta(actor)),
    del: async (input: Input<"del">, actor?: VaultActor) =>
      binding.del(input, await buildMeta(actor)),
    setDefault: async (input: Input<"setDefault">, actor?: VaultActor) =>
      binding.setDefault(input, await buildMeta(actor)),
    // spend
    getToken: async (input: Input<"getToken">, actor?: VaultActor) =>
      binding.getToken(input, await buildMeta(actor)),
    inject: async (input: Input<"inject">, actor?: VaultActor) =>
      binding.inject(input, await buildMeta(actor)),
    // oauth
    oauthBegin: async (input: Input<"oauthBegin">, actor?: VaultActor) =>
      binding.oauthBegin(input, await buildMeta(actor)),
    oauthCallback: async (input: Input<"oauthCallback">, actor?: VaultActor) =>
      binding.oauthCallback(input, await buildMeta(actor)),
    // admin
    killTenant: async (input: Input<"killTenant">, actor?: VaultActor) =>
      binding.killTenant(input, await buildMeta(actor)),
    rotateKek: async (input: Input<"rotateKek">, actor?: VaultActor) =>
      binding.rotateKek(input, await buildMeta(actor)),
    auditRecent: async (input: Input<"auditRecent">, actor?: VaultActor) =>
      binding.auditRecent(input, await buildMeta(actor)),
  };
}

export type VaultClient = ReturnType<typeof createVaultClient>;

function foldAnonymous(actor: VaultActor, callerApp: string): Actor {
  if (actor.kind === "anonymous") {
    return { kind: "service", serviceName: `${callerApp}-anon:${actor.label}` };
  }
  return actor;
}
