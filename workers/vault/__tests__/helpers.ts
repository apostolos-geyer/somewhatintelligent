/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { createExecutionContext, env } from "cloudflare:test";
import type { VaultTenantDO } from "../src/do/tenant-do";
import type { VaultInstance } from "../src/log";
import type { CallMeta } from "../src/meta";
import type { VaultEnv } from "../src/vault-env";

export const CALLER_APP = "test-app";

/** Meta with the callerApp fallback (ctx.props is dropped in the test path). */
export const META: CallMeta = {
  actor: { kind: "service", serviceName: "vault-tests" },
  requestId: "req-test",
  callerApp: CALLER_APP,
};

/**
 * Entry-worker instance view for calling src/methods/* directly.
 * (The full RPC surface is exercised via env.VAULT_RPC in entry.test.ts.)
 */
export function makeVault(): VaultInstance {
  const ctx = createExecutionContext();
  (ctx as { props?: unknown }).props = { callerApp: CALLER_APP };
  return { ctx, env: env as unknown as VaultEnv } as VaultInstance;
}

/**
 * Storage isolation in this pool version is per test FILE, not per test —
 * every test gets its own tenant so DO state can never bleed between tests.
 */
export function uniqueTenant(prefix = "tenant"): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 12)}`;
}

export function tenantStubFor(tenantId: string): DurableObjectStub<VaultTenantDO> {
  return env.VAULT_TENANT.get(env.VAULT_TENANT.idFromName(tenantId));
}
