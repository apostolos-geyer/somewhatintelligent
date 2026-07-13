// Entry trampoline targets for the ops surface.
import type { AuditRow } from "../do/audit";
import type { RotateError, RotateOutcome } from "../do/rotate";
import type { VaultInstance } from "../log";
import type { CallMeta } from "../meta";
import type { Result } from "../result";
import { attribution, checkTenant, tenantStub, type TenantInvalid } from "./shared";

export async function killTenant(
  self: VaultInstance,
  input: { tenantId: string },
  meta: CallMeta,
): Promise<Result<{ grants: number }, TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  const value = await tenantStub(self, tenant.value).killTenant(input, attribution(self, meta));
  return { ok: true, value };
}

// Fleet-wide rotation is caller-orchestrated in v1: whoever minted the
// tenants knows their ids (vault keeps no cross-tenant index by design,
// NFR-2) — call this per tenant until done: true. See README.
export async function rotateKek(
  self: VaultInstance,
  input: { tenantId: string; toVersion?: number },
  meta: CallMeta,
): Promise<Result<RotateOutcome, RotateError | TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).rotateKek(input, attribution(self, meta));
}

export async function auditRecent(
  self: VaultInstance,
  input: { tenantId: string; limit?: number },
  meta: CallMeta,
): Promise<Result<AuditRow[], TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  const value = await tenantStub(self, tenant.value).auditRecent(input, attribution(self, meta));
  return { ok: true, value };
}
