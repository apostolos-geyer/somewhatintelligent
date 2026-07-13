// Race-free token refresh (FR-9). The DO's single-threaded event loop makes
// the check-then-set on `inflightRefresh` atomic: N concurrent spends against
// an expired grant share ONE upstream refresh; callers never observe
// intermediate states. Health transitions per FR-10.
import { eq } from "drizzle-orm";
import { openPayload, sealPayload, unwrapDek, type GrantPayload } from "../crypto/envelope";
import { loadKek } from "../crypto/keys";
import { err, ok, type Result } from "../result";
import type { Destination } from "../registry";
import { oauthClientCreds } from "./creds";
import { aadFor, markUnhealthy, openGrantRow } from "./grants";
import type { GrantRow, TenantInstance } from "./instance";
import { grants } from "./schema";

/** Refresh when the access token expires within this window (or already has). */
const EXPIRY_SKEW_MS = 30_000;

export type RefreshResult = Result<GrantRow, "refresh_failed" | "grant_unhealthy">;

function needsRefresh(dest: Destination, row: GrantRow, now: number, horizonMs: number): boolean {
  if (row.kind !== "oauth" || !dest.oauth?.refreshable) return false;
  if (row.expiresAt === null) return false;
  return row.expiresAt <= now + horizonMs;
}

/**
 * Returns a fresh row, refreshing through the single-flight gate when the
 * access token is stale. Non-refreshable material passes straight through.
 * Spend paths use the default 30s skew; the alarm sweep passes its
 * per-destination lead so near-expiry grants refresh proactively (FR-10).
 */
export async function ensureFresh(
  self: TenantInstance,
  dest: Destination,
  row: GrantRow,
  opts?: { horizonMs?: number },
): Promise<RefreshResult> {
  if (!needsRefresh(dest, row, Date.now(), opts?.horizonMs ?? EXPIRY_SKEW_MS)) return ok(row);
  let inflight = self.inflightRefresh.get(row.grantId);
  if (!inflight) {
    inflight = refreshGrant(self, dest, row).finally(() => {
      self.inflightRefresh.delete(row.grantId);
    });
    self.inflightRefresh.set(row.grantId, inflight);
  }
  return inflight;
}

/** One upstream refresh + re-seal. Callers go through ensureFresh. */
async function refreshGrant(
  self: TenantInstance,
  dest: Destination,
  row: GrantRow,
): Promise<RefreshResult> {
  const opened = await openGrantRow(self, row);
  if (!opened.ok) return opened;
  const payload = opened.value;
  if (!payload.refreshToken) {
    // Expired with nothing to refresh with: dead until re-auth.
    markUnhealthy(self, row.grantId, "revoked_upstream");
    return err("refresh_failed", `grant ${dest.id}/${row.label} has no refresh token`);
  }
  const oauth = dest.oauth;
  const creds = oauth && oauthClientCreds(self.env, dest);
  if (!oauth || !creds) {
    return err("refresh_failed", `destination "${dest.id}" oauth client is not configured`);
  }

  const upstream = await callTokenEndpoint(oauth.tokenUrl, {
    grant_type: "refresh_token",
    refresh_token: payload.refreshToken,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  if (!upstream.ok) {
    if (upstream.permanent) {
      // The provider rejected the refresh token itself — re-auth required.
      markUnhealthy(self, row.grantId, "revoked_upstream");
    }
    return err("refresh_failed", upstream.message);
  }

  const now = Date.now();
  const t = upstream.value;
  const nextPayload: GrantPayload = {
    kind: "oauth",
    accessToken: t.accessToken,
    // Providers may rotate the refresh token; keep the old one otherwise.
    refreshToken: t.refreshToken ?? payload.refreshToken,
    scopes: t.scopes ?? payload.scopes,
    obtainedAt: now,
    ...(t.expiresAt !== undefined && { expiresAt: t.expiresAt }),
  };

  // Re-seal under the SAME DEK and AAD (nothing in the row identity moved);
  // fresh IV per GCM rules.
  const kek = await loadKek(self.env, row.kekVersion);
  const dek = await unwrapDek(new Uint8Array(row.dekWrapped), kek);
  const aad = aadFor(self, row);
  const sealed = await sealPayload(nextPayload, dek, aad);
  self.db
    .update(grants)
    .set({
      ciphertext: Buffer.from(sealed.ciphertext),
      iv: Buffer.from(sealed.iv),
      expiresAt: nextPayload.expiresAt ?? null,
      scopes: JSON.stringify(nextPayload.scopes),
      health: "ok",
      unhealthyReason: null,
    })
    .where(eq(grants.grantId, row.grantId))
    .run();
  const fresh = self.db.select().from(grants).where(eq(grants.grantId, row.grantId)).get();
  if (!fresh) return err("refresh_failed", "grant deleted mid-refresh");
  // Sanity: the re-sealed payload must round-trip before anyone spends it.
  await openPayload(
    { ciphertext: new Uint8Array(fresh.ciphertext), iv: new Uint8Array(fresh.iv) },
    dek,
    aad,
  );
  return ok(fresh);
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

export async function callTokenEndpoint(
  tokenUrl: string,
  form: Record<string, string>,
): Promise<
  { ok: true; value: TokenResponse } | { ok: false; permanent: boolean; message: string }
> {
  let res: Response;
  try {
    res = await fetch(tokenUrl, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(form).toString(),
    });
  } catch {
    return { ok: false, permanent: false, message: "token endpoint unreachable" };
  }
  if (!res.ok) {
    // 4xx = the request itself is rejected (invalid_grant &c.) — permanent.
    // 5xx = provider trouble — transient.
    return {
      ok: false,
      permanent: res.status >= 400 && res.status < 500,
      message: `token endpoint returned ${res.status}`,
    };
  }
  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return { ok: false, permanent: false, message: "token endpoint returned non-JSON" };
  }
  const accessToken = body.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) {
    return { ok: false, permanent: true, message: "token response missing access_token" };
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : undefined;
  const scope = typeof body.scope === "string" ? body.scope : undefined;
  return {
    ok: true,
    value: {
      accessToken,
      ...(typeof body.refresh_token === "string" && { refreshToken: body.refresh_token }),
      ...(expiresIn !== undefined && { expiresAt: Date.now() + expiresIn * 1000 }),
      ...(scope !== undefined && { scopes: scope.split(/[\s,]+/).filter(Boolean) }),
    },
  };
}
