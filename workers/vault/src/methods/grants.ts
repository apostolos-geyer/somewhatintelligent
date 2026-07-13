// Entry trampoline targets for grant CRUD. Validation + forwarding only.
import type { DelError, DelOutcome, PutError, SetDefaultError } from "../do/grants";
import type { VaultInstance } from "../log";
import type { CallMeta } from "../meta";
import type { Result } from "../result";
import type { GrantMeta, PutInput } from "../types";
import { attribution, checkTenant, tenantStub, type TenantInvalid } from "./shared";

export async function put(
  self: VaultInstance,
  input: PutInput,
  meta: CallMeta,
): Promise<Result<GrantMeta, PutError | TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).put(input, attribution(self, meta));
}

export async function list(
  self: VaultInstance,
  input: { tenantId: string; dest?: string },
  meta: CallMeta,
): Promise<Result<GrantMeta[], TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  const value = await tenantStub(self, tenant.value).list(input, attribution(self, meta));
  return { ok: true, value };
}

export async function del(
  self: VaultInstance,
  input: { tenantId: string; dest: string; label?: string },
  meta: CallMeta,
): Promise<Result<DelOutcome, DelError | TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).del(input, attribution(self, meta));
}

export async function setDefault(
  self: VaultInstance,
  input: { tenantId: string; dest: string; label: string; confirmLive?: boolean },
  meta: CallMeta,
): Promise<Result<GrantMeta, SetDefaultError | TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).setDefault(input, attribution(self, meta));
}
