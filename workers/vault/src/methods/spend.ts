// Entry trampoline targets for the spend paths.
import type { GetTokenError, InjectError } from "../do/spend";
import type { VaultInstance } from "../log";
import type { CallMeta } from "../meta";
import type { Result } from "../result";
import type { AccessMaterial, InjectResult, InjectSpec, SpendSelector } from "../types";
import { attribution, checkTenant, tenantStub, type TenantInvalid } from "./shared";

export async function getToken(
  self: VaultInstance,
  input: SpendSelector,
  meta: CallMeta,
): Promise<Result<AccessMaterial, GetTokenError | TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).getToken(input, attribution(self, meta));
}

export async function inject(
  self: VaultInstance,
  input: SpendSelector & { request: InjectSpec },
  meta: CallMeta,
): Promise<Result<InjectResult, InjectError | TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).inject(input, attribution(self, meta));
}
