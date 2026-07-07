/**
 * PURE credential helpers — the CanSell validity logic. No `cloudflare:workers`,
 * env, or React, so it's unit-testable in plain node (mirroring `brand.ts`).
 * `credentials.functions` (server) + the Hub card both derive status from here so
 * "is this cert usable" can't drift.
 */

/** The derived usability of a budtender's certification. */
export type CredentialState = "missing" | "pending" | "rejected" | "expired" | "valid";

/**
 * Usability of a credential at `nowMs`:
 *  - `missing`  — no row on file (nothing submitted yet);
 *  - `rejected` — an admin rejected the submission;
 *  - `expired`  — past its `expires_at` (regardless of status);
 *  - `pending`  — submitted, awaiting admin review;
 *  - `valid`    — an admin VERIFIED it AND it has not yet expired.
 *
 * Order matters: a rejected cert reads `rejected` even if also expired (the
 * actionable signal is the rejection); an expired cert reads `expired` before we
 * consider pending/verified (an expired verified cert is no longer usable). A
 * `valid` credential is the "valid CanSell" the soft prompt stops nudging about.
 */
export function credentialState(
  cred: { status: string; expiresAt: number } | null | undefined,
  nowMs: number,
): CredentialState {
  if (!cred) return "missing";
  if (cred.status === "rejected") return "rejected";
  if (cred.expiresAt <= nowMs) return "expired";
  if (cred.status === "pending") return "pending";
  if (cred.status === "verified") return "valid";
  return "pending";
}

/** True when the budtender holds a usable (verified, unexpired) certification. */
export function isCredentialValid(
  cred: { status: string; expiresAt: number } | null | undefined,
  nowMs: number,
): boolean {
  return credentialState(cred, nowMs) === "valid";
}
