// Best-effort upstream revocation (FR-3). Failure never blocks local
// destruction — the ciphertext dies either way; the boolean reports whether
// the upstream acknowledged.
import type { GrantPayload } from "../crypto/envelope";
import type { Destination } from "../registry";
import { oauthClientCreds } from "./creds";
import type { TenantInstance } from "./instance";

export async function revokeUpstream(
  self: TenantInstance,
  dest: Destination,
  payload: GrantPayload,
): Promise<boolean> {
  const revoke = dest.revoke;
  if (!revoke) return false;
  const token = payload.kind === "oauth" ? payload.accessToken : payload.apiKey;
  if (!token) return false;

  let url = revoke.url;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  const creds = oauthClientCreds(self.env, dest);
  if (creds) {
    url = url.replace("{client_id}", creds.clientId);
    headers.authorization = `Basic ${btoa(`${creds.clientId}:${creds.clientSecret}`)}`;
  } else if (url.includes("{client_id}")) {
    // Revocation endpoint needs client creds that aren't configured.
    return false;
  }
  try {
    const res = await fetch(url, {
      method: revoke.method ?? "POST",
      headers,
      body: JSON.stringify({ access_token: token }),
    });
    // 404 = grant already gone upstream — that's the goal state.
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
