// OAuth lifecycle (FR-2): consent handoff, signed single-use state, code
// exchange, grant storage. State is HMAC-SHA-256 over the binding tuple
// (tenant, dest, label, env, nonce, exp) with a dedicated signing key;
// single-use is enforced by the nonce row in this DO.
import { eq } from "drizzle-orm";
import { base64Decode } from "../crypto/keys";
import type { VaultErrorCode } from "../errors";
import { err, ok, type Result } from "../result";
import type { Destination } from "../registry";
import { LABEL_RE, type GrantEnv, type GrantMeta } from "../types";
import { audit } from "./audit";
import { oauthClientCreds } from "./creds";
import { put, requireDest } from "./grants";
import type { Attribution, TenantInstance } from "./instance";
import { callTokenEndpoint } from "./refresh";
import { oauthState } from "./schema";
import type { VaultEnv } from "../vault-env";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_VERSION = "v1";

interface StatePayload {
  t: string; // tenantId
  d: string; // dest
  l: string; // label
  e: GrantEnv | null;
  n: string; // nonce
  x: number; // exp, ms epoch
}

// ── state signing ──────────────────────────────────────────────────────

// Import the HMAC key once per isolate (keyed by material, mirroring
// crypto/keys.ts's kekCache) rather than on every mint/verify.
const stateKeyCache = new Map<string, Promise<CryptoKey>>();

function stateKey(env: VaultEnv): Promise<CryptoKey> {
  const b64 = env.VAULT_STATE_HMAC;
  if (typeof b64 !== "string" || b64.length === 0) {
    throw new Error("VAULT_STATE_HMAC binding is missing");
  }
  let key = stateKeyCache.get(b64);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      base64Decode(b64) as BufferSource,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    stateKeyCache.set(b64, key);
  }
  return key;
}

function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const b64 = s.replaceAll("-", "+").replaceAll("_", "/");
  return base64Decode(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
}

async function mintState(env: VaultEnv, payload: StatePayload): Promise<string> {
  const body = new TextEncoder().encode(JSON.stringify(payload));
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", await stateKey(env), body as BufferSource),
  );
  return `${STATE_VERSION}.${b64url(body)}.${b64url(mac)}`;
}

/**
 * Structure + signature check. crypto.subtle.verify is constant-time.
 * Exposed for the entry worker's DO-routing decode via `decodeStateTenant`
 * (which deliberately does NOT verify — the DO always re-verifies).
 */
export async function verifyState(env: VaultEnv, state: string): Promise<StatePayload | null> {
  const parts = state.split(".");
  if (parts.length !== 3 || parts[0] !== STATE_VERSION || !parts[1] || !parts[2]) return null;
  let body: Uint8Array;
  let mac: Uint8Array;
  try {
    body = b64urlDecode(parts[1]);
    mac = b64urlDecode(parts[2]);
  } catch {
    return null;
  }
  const valid = await crypto.subtle.verify(
    "HMAC",
    await stateKey(env),
    mac as BufferSource,
    body as BufferSource,
  );
  if (!valid) return null;
  try {
    return JSON.parse(new TextDecoder().decode(body)) as StatePayload;
  } catch {
    return null;
  }
}

/** Routing-only decode (no verification!) so the entry worker can pick the DO. */
export function decodeStateTenant(state: string): string | null {
  const parts = state.split(".");
  if (parts.length !== 3 || !parts[1]) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]))) as StatePayload;
    return typeof payload.t === "string" && payload.t.length > 0 ? payload.t : null;
  } catch {
    return null;
  }
}

// ── begin (FR-2) ───────────────────────────────────────────────────────

export type OAuthBeginError = Extract<
  VaultErrorCode,
  "dest_unknown" | "dest_disabled" | "oauth_not_supported" | "label_invalid" | "env_required"
>;

export async function oauthBegin(
  self: TenantInstance,
  input: {
    dest: string;
    label: string;
    redirectUri: string;
    scopes?: string[];
    env?: GrantEnv;
  },
  attr: Attribution,
): Promise<Result<{ authorizeUrl: string }, OAuthBeginError>> {
  const destR = requireDest(input.dest);
  if (!destR.ok) return destR;
  const dest = destR.value;
  if (dest.kind !== "oauth" || !dest.oauth) {
    return err("oauth_not_supported", `destination "${dest.id}" is not an OAuth destination`);
  }
  if (!LABEL_RE.test(input.label)) {
    return err("label_invalid", "label must be a 1-32 char slug: [a-z0-9][a-z0-9-]*");
  }
  const env = input.env ?? null;
  if (dest.envSensitive && !env) {
    return err("env_required", `destination "${dest.id}" is env-sensitive: declare env live|test`);
  }
  const creds = oauthClientCreds(self.env, dest);
  if (!creds) {
    return err("oauth_not_supported", `destination "${dest.id}" oauth client is not configured`);
  }

  const scopes = input.scopes ?? [...(dest.oauth.defaultScopes ?? [])];
  const nonce = crypto.randomUUID();
  const exp = Date.now() + STATE_TTL_MS;
  self.db
    .insert(oauthState)
    .values({
      nonce,
      dest: input.dest,
      label: input.label,
      env,
      scopes: JSON.stringify(scopes),
      redirectUri: input.redirectUri,
      exp,
    })
    .run();

  const state = await mintState(self.env, {
    t: self.tenantId,
    d: input.dest,
    l: input.label,
    e: env,
    n: nonce,
    x: exp,
  });
  const url = new URL(dest.oauth.authorizeUrl);
  url.searchParams.set("client_id", creds.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  if (scopes.length > 0) url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  audit(self, { op: "oauth_begin", outcome: "ok", dest: input.dest, label: input.label, ...attr });
  return ok({ authorizeUrl: url.toString() });
}

// ── callback (FR-2) ────────────────────────────────────────────────────

export type OAuthCallbackError = Extract<
  VaultErrorCode,
  | "state_invalid"
  | "oauth_exchange_failed"
  | "dest_unknown"
  | "dest_disabled"
  | "label_invalid"
  | "material_mismatch"
  | "env_required"
  | "env_mismatch"
  | "env_immutable"
>;

export async function oauthCallback(
  self: TenantInstance,
  input: { code: string; state: string },
  attr: Attribution,
): Promise<Result<GrantMeta, OAuthCallbackError>> {
  const payload = await verifyState(self.env, input.state);
  const fail = (why: string) => {
    audit(self, { op: "oauth_callback", outcome: "state_invalid", ...attr });
    return err("state_invalid" as const, `OAuth state rejected: ${why}`);
  };
  if (!payload) return fail("bad signature or structure");
  if (payload.t !== self.tenantId) return fail("tenant binding mismatch");
  if (payload.x <= Date.now()) return fail("expired");

  // Single-use: consume the nonce row BEFORE the upstream exchange so a
  // replayed state can never trigger a second exchange.
  const row = self.db.select().from(oauthState).where(eq(oauthState.nonce, payload.n)).get();
  if (!row) return fail("state already used or unknown");
  self.db.delete(oauthState).where(eq(oauthState.nonce, payload.n)).run();
  if (row.dest !== payload.d || row.label !== payload.l || (row.env ?? null) !== payload.e) {
    return fail("binding mismatch");
  }
  if (row.exp <= Date.now()) return fail("expired");

  const destR = requireDest(payload.d);
  if (!destR.ok) return destR;
  const dest: Destination = destR.value;
  const creds = dest.oauth && oauthClientCreds(self.env, dest);
  if (!dest.oauth || !creds) {
    return err(
      "oauth_exchange_failed",
      `destination "${payload.d}" oauth client is not configured`,
    );
  }

  const exchanged = await callTokenEndpoint(dest.oauth.tokenUrl, {
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: row.redirectUri,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });
  if (!exchanged.ok) {
    audit(self, {
      op: "oauth_callback",
      outcome: "oauth_exchange_failed",
      dest: payload.d,
      label: payload.l,
      ...attr,
    });
    return err("oauth_exchange_failed", exchanged.message);
  }
  const t = exchanged.value;
  const stored = await put(
    self,
    {
      tenantId: self.tenantId,
      dest: payload.d,
      label: payload.l,
      ...(payload.e !== null && { env: payload.e }),
      material: {
        kind: "oauth",
        accessToken: t.accessToken,
        ...(t.refreshToken !== undefined && { refreshToken: t.refreshToken }),
        ...(t.expiresAt !== undefined && { expiresAt: t.expiresAt }),
        scopes: t.scopes ?? (JSON.parse(row.scopes) as string[]),
      },
    },
    attr,
  );
  if (!stored.ok) return stored;
  audit(self, { op: "oauth_callback", outcome: "ok", dest: payload.d, label: payload.l, ...attr });
  return stored;
}
