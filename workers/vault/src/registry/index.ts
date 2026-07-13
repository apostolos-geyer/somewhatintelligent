import { DESTINATIONS } from "./destinations";
import type { Destination } from "./types";

export type { DestKind, DestOAuth, DestRevoke, Destination } from "./types";
export { DESTINATIONS } from "./destinations";

const byId = new Map(DESTINATIONS.map((d) => [d.id, d]));

export function getDestination(id: string): Destination | undefined {
  return byId.get(id);
}

/**
 * Host allowlist check for inject targets (FR-7). https only; hostname must
 * match an allowlisted entry exactly, or fall under a "*.suffix" wildcard
 * (subdomains only — the wildcard never matches the bare suffix).
 * Fail closed: any parse failure is a refusal.
 */
export function hostAllowed(dest: Destination, rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  for (const entry of dest.allowHosts) {
    const allowed = entry.toLowerCase();
    if (allowed.startsWith("*.")) {
      if (host.endsWith(allowed.slice(1)) && host.length > allowed.length - 1) return true;
    } else if (host === allowed) {
      return true;
    }
  }
  return false;
}
