// Entry-side helpers: tenant validation + DO stub resolution. The entry
// worker holds NO crypto and never sees token material (except relaying
// getToken's scoped return) — it validates shapes, resolves tenant → DO,
// and forwards.
import type { VaultTenantDO } from "../do/tenant-do";
import type { Attribution } from "../do/instance";
import { readCallerApp, type VaultInstance } from "../log";
import type { CallMeta } from "../meta";
import { err, type Result } from "../result";
import { TENANT_RE } from "../types";

export type TenantInvalid = "tenant_invalid";

export function checkTenant(tenantId: unknown): Result<string, TenantInvalid> {
  if (typeof tenantId !== "string" || !TENANT_RE.test(tenantId)) {
    return err("tenant_invalid", "tenantId must be a 1-64 char slug: [A-Za-z0-9_-]+");
  }
  return { ok: true, value: tenantId };
}

export function tenantStub(
  self: VaultInstance,
  tenantId: string,
): DurableObjectStub<VaultTenantDO> {
  return self.env.VAULT_TENANT.get(self.env.VAULT_TENANT.idFromName(tenantId));
}

export function attribution(self: VaultInstance, meta: CallMeta): Attribution {
  return { callerApp: readCallerApp(self, meta) };
}
