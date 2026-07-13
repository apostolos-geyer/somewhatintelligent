// AAD construction (PRD §7). Every GCM seal binds the full row identity:
// ciphertext moved to any other tenant, destination, label, environment,
// grant, or key epoch fails authentication. Components are slug-validated
// upstream (TENANT_RE / LABEL_RE; dest ids are registry-owned), so the `|`
// join is unambiguous.
import type { GrantEnv } from "../types";

export interface AadParts {
  tenantId: string;
  dest: string;
  label: string;
  env: GrantEnv | null;
  grantId: string;
  kekVersion: number;
}

export function buildAad(p: AadParts): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    [p.tenantId, p.dest, p.label, p.env ?? "", p.grantId, String(p.kekVersion)].join("|"),
  );
}
