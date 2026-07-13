// Spend paths: getToken (FR-8) and inject (FR-6/7). The inject forwarder
// checks the host allowlist BEFORE touching any row or key material (fail
// closed), strips caller credential headers, stamps the registry's header
// template, and tags the response with the spent grant.
import type { GrantPayload } from "../crypto/envelope";
import type { VaultErrorCode } from "../errors";
import { err, ok, type Result } from "../result";
import { hostAllowed, type Destination } from "../registry";
import {
  MAX_INJECT_REQUEST_BODY,
  MAX_INJECT_RESPONSE_BODY,
  type AccessMaterial,
  type GrantEnv,
  type InjectResult,
  type InjectSpec,
} from "../types";
import { audit } from "./audit";
import { openGrantRow, requireDest, selectGrant, touchLastUsed } from "./grants";
import type { Attribution, GrantRow, TenantInstance } from "./instance";
import { ensureFresh } from "./refresh";

export type SpendError = Extract<
  VaultErrorCode,
  | "dest_unknown"
  | "dest_disabled"
  | "grant_missing"
  | "grant_ambiguous"
  | "live_requires_explicit_label"
  | "grant_unhealthy"
  | "refresh_failed"
>;

export type GetTokenError = SpendError | "get_token_disabled";
export type InjectError =
  | SpendError
  | "host_not_allowed"
  | "body_too_large"
  | "upstream_unreachable";

/** Select the grant + ensure freshness — the shared middle of both spends.
 * The dest is already resolved by the caller (so requireDest runs once). */
async function resolveGrant(
  self: TenantInstance,
  dest: Destination,
  label: string | undefined,
  op: string,
  attr: Attribution,
): Promise<Result<GrantRow, SpendError>> {
  const selected = selectGrant(self, dest, label);
  if (!selected.ok) {
    audit(self, { op, outcome: selected.error, dest: dest.id, label, ...attr });
    return selected;
  }
  const fresh = await ensureFresh(self, dest, selected.value);
  if (!fresh.ok) {
    audit(self, { op, outcome: fresh.error, dest: dest.id, label: selected.value.label, ...attr });
    return fresh;
  }
  return ok(fresh.value);
}

/** Decrypt the grant and pull its spendable material; audits the failure
 * branches shared by getToken and inject. */
async function openSpendable(
  self: TenantInstance,
  row: GrantRow,
  op: string,
  attr: Attribution,
): Promise<Result<{ token: string; payload: GrantPayload }, "grant_unhealthy">> {
  const opened = await openGrantRow(self, row);
  if (!opened.ok) {
    audit(self, { op, outcome: opened.error, dest: row.dest, label: row.label, ...attr });
    return opened;
  }
  const token = row.kind === "oauth" ? opened.value.accessToken : opened.value.apiKey;
  if (!token) {
    audit(self, { op, outcome: "grant_unhealthy", dest: row.dest, label: row.label, ...attr });
    return err("grant_unhealthy", `grant ${row.dest}/${row.label} carries no access material`);
  }
  return ok({ token, payload: opened.value });
}

// ── getToken (FR-8) ────────────────────────────────────────────────────

export async function getToken(
  self: TenantInstance,
  input: { dest: string; label?: string },
  attr: Attribution,
): Promise<Result<AccessMaterial, GetTokenError>> {
  const destR = requireDest(input.dest);
  if (!destR.ok) {
    audit(self, { op: "get_token", outcome: destR.error, dest: input.dest, ...attr });
    return destR;
  }
  const dest = destR.value;
  if (dest.kind !== "oauth" && !dest.getTokenEnabled) {
    // Raw long-lived keys are spent via inject, not handed out (FR-8).
    audit(self, { op: "get_token", outcome: "get_token_disabled", dest: input.dest, ...attr });
    return err(
      "get_token_disabled",
      `destination "${input.dest}" does not allow getToken — use inject`,
    );
  }
  const resolved = await resolveGrant(self, dest, input.label, "get_token", attr);
  if (!resolved.ok) return resolved;
  const row = resolved.value;

  const spendable = await openSpendable(self, row, "get_token", attr);
  if (!spendable.ok) return spendable;
  touchLastUsed(self, row.grantId);
  audit(self, { op: "get_token", outcome: "ok", dest: row.dest, label: row.label, ...attr });
  return ok({
    token: spendable.value.token,
    expiresAt: row.expiresAt,
    scopes: spendable.value.payload.scopes,
    env: (row.env as GrantEnv | null) ?? null,
  });
}

// ── inject (FR-6/7) ────────────────────────────────────────────────────

/**
 * Caller headers that can never pass through to the upstream: anything
 * credential-shaped is stripped and (where templated) overwritten.
 */
const STRIPPED_HEADERS = ["authorization", "proxy-authorization", "cookie", "x-api-key"];

export async function inject(
  self: TenantInstance,
  input: { dest: string; label?: string; request: InjectSpec },
  attr: Attribution,
): Promise<Result<InjectResult, InjectError>> {
  const destR = requireDest(input.dest);
  if (!destR.ok) {
    audit(self, { op: "inject", outcome: destR.error, dest: input.dest, ...attr });
    return destR;
  }
  const dest = destR.value;

  // FAIL CLOSED before any row read or key touch (FR-7).
  if (!hostAllowed(dest, input.request.url)) {
    audit(self, { op: "inject", outcome: "host_not_allowed", dest: input.dest, ...attr });
    return err(
      "host_not_allowed",
      `target host is not allowlisted for "${dest.id}" (https + ${dest.allowHosts.join(", ")})`,
    );
  }
  const body = normalizeBody(input.request.body);
  if (body !== undefined && body.byteLength > MAX_INJECT_REQUEST_BODY) {
    audit(self, { op: "inject", outcome: "body_too_large", dest: input.dest, ...attr });
    return err("body_too_large", `request body exceeds ${MAX_INJECT_REQUEST_BODY} bytes`);
  }

  const resolved = await resolveGrant(self, dest, input.label, "inject", attr);
  if (!resolved.ok) return resolved;
  const row = resolved.value;

  const spendable = await openSpendable(self, row, "inject", attr);
  if (!spendable.ok) return spendable;
  const token = spendable.value.token;

  // Strip-then-stamp: caller-supplied credential headers never survive.
  const headers = new Headers();
  for (const [k, v] of Object.entries(input.request.headers ?? {})) {
    const key = k.toLowerCase();
    if (STRIPPED_HEADERS.includes(key)) continue;
    if (key in dest.headerTemplate) continue;
    headers.set(key, v);
  }
  for (const [k, template] of Object.entries(dest.headerTemplate)) {
    headers.set(k, template.replace("{token}", token));
  }

  let upstream: Response;
  try {
    upstream = await fetch(input.request.url, {
      method: input.request.method ?? "GET",
      headers,
      ...(body !== undefined && { body: body as BodyInit }),
    });
  } catch (e) {
    audit(self, {
      op: "inject",
      outcome: "upstream_unreachable",
      dest: row.dest,
      label: row.label,
      ...attr,
    });
    return err(
      "upstream_unreachable",
      `upstream fetch failed: ${e instanceof Error ? e.name : "error"}`,
    );
  }

  const responseBody = await upstream.arrayBuffer();
  if (responseBody.byteLength > MAX_INJECT_RESPONSE_BODY) {
    audit(self, {
      op: "inject",
      outcome: "body_too_large",
      dest: row.dest,
      label: row.label,
      ...attr,
    });
    return err("body_too_large", `upstream response exceeds ${MAX_INJECT_RESPONSE_BODY} bytes`);
  }
  const responseHeaders: Record<string, string> = {};
  upstream.headers.forEach((v, k) => {
    responseHeaders[k] = v;
  });
  // Which environment was spent — consumers surface this (FR-6, FR-17 rail).
  responseHeaders["x-vault-grant"] = `${row.dest}/${row.label}`;

  touchLastUsed(self, row.grantId);
  audit(self, { op: "inject", outcome: "ok", dest: row.dest, label: row.label, ...attr });
  return ok({
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
    body: responseBody,
  });
}

function normalizeBody(body: InjectSpec["body"]): Uint8Array | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  return body;
}
