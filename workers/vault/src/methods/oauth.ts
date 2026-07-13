// Entry trampoline targets for the OAuth flows. The callback routes by the
// tenant embedded in the state token (decode WITHOUT verify — the DO
// re-verifies the HMAC, which covers the tenant binding; a forged tenant
// lands in a DO whose pinned identity and nonce table both reject it).
import { decodeStateTenant, type OAuthBeginError, type OAuthCallbackError } from "../do/oauth";
import type { VaultInstance } from "../log";
import type { CallMeta } from "../meta";
import { err, type Result } from "../result";
import type { GrantMeta, OAuthBeginInput, OAuthCallbackInput } from "../types";
import { attribution, checkTenant, tenantStub, type TenantInvalid } from "./shared";

export async function oauthBegin(
  self: VaultInstance,
  input: OAuthBeginInput,
  meta: CallMeta,
): Promise<Result<{ authorizeUrl: string }, OAuthBeginError | TenantInvalid>> {
  const tenant = checkTenant(input.tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).oauthBegin(input, attribution(self, meta));
}

export async function oauthCallback(
  self: VaultInstance,
  input: OAuthCallbackInput,
  meta: CallMeta,
): Promise<Result<GrantMeta, OAuthCallbackError | TenantInvalid>> {
  const tenantId = input.tenantId ?? decodeStateTenant(input.state);
  if (tenantId === null) {
    return err("state_invalid", "OAuth state rejected: unreadable");
  }
  const tenant = checkTenant(tenantId);
  if (!tenant.ok) return tenant;
  return tenantStub(self, tenant.value).oauthCallback(
    { tenantId: tenant.value, code: input.code, state: input.state },
    attribution(self, meta),
  );
}
