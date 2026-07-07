/**
 * Unit tests for the PURE CanSell credential logic (`src/lib/credentials.ts`).
 *
 * `credentialState` is the single source of truth the server fns AND the Hub soft
 * prompt both derive from, so "is this cert usable" can't drift. These codify the
 * EXACT verdict for all five states + the order-sensitive precedence (rejected
 * before expired; expired before pending/verified), plus `isCredentialValid`.
 *
 * Node-pure (no env / React / cloudflare:workers) — runs in the plain `bun run
 * test` pool, mirroring grading.test.ts.
 */
import { describe, expect, it } from "vitest";
import { credentialState, isCredentialValid } from "@/lib/credentials";

const NOW = 1_700_000_000_000; // fixed "now" so the tests are deterministic
const FUTURE = NOW + 86_400_000; // +1 day (unexpired)
const PAST = NOW - 86_400_000; // -1 day (expired)

const cred = (status: string, expiresAt: number) => ({ status, expiresAt });

describe("credentialState — the five derived states", () => {
  it("missing — no row on file", () => {
    expect(credentialState(null, NOW)).toBe("missing");
    expect(credentialState(undefined, NOW)).toBe("missing");
  });

  it("pending — submitted, awaiting admin review (and not yet expired)", () => {
    expect(credentialState(cred("pending", FUTURE), NOW)).toBe("pending");
  });

  it("rejected — an admin rejected the submission", () => {
    expect(credentialState(cred("rejected", FUTURE), NOW)).toBe("rejected");
  });

  it("expired — past expires_at (a verified-but-expired cert is no longer usable)", () => {
    expect(credentialState(cred("verified", PAST), NOW)).toBe("expired");
  });

  it("valid — VERIFIED and not yet expired", () => {
    expect(credentialState(cred("verified", FUTURE), NOW)).toBe("valid");
  });
});

describe("credentialState — precedence / edge ordering", () => {
  it("rejected wins over expired (the rejection is the actionable signal)", () => {
    expect(credentialState(cred("rejected", PAST), NOW)).toBe("rejected");
  });

  it("expired wins over pending (an expired pending submission reads expired)", () => {
    expect(credentialState(cred("pending", PAST), NOW)).toBe("expired");
  });

  it("expiry is inclusive at the boundary (expiresAt === now → expired)", () => {
    expect(credentialState(cred("verified", NOW), NOW)).toBe("expired");
  });

  it("one ms before expiry is still valid", () => {
    expect(credentialState(cred("verified", NOW + 1), NOW)).toBe("valid");
  });

  it("an unknown status (not pending/verified/rejected) falls back to pending", () => {
    expect(credentialState(cred("weird", FUTURE), NOW)).toBe("pending");
  });
});

describe("isCredentialValid — usable iff state is 'valid'", () => {
  it("true only for verified + unexpired", () => {
    expect(isCredentialValid(cred("verified", FUTURE), NOW)).toBe(true);
  });

  it("false for missing / pending / rejected / expired", () => {
    expect(isCredentialValid(null, NOW)).toBe(false);
    expect(isCredentialValid(cred("pending", FUTURE), NOW)).toBe(false);
    expect(isCredentialValid(cred("rejected", FUTURE), NOW)).toBe(false);
    expect(isCredentialValid(cred("verified", PAST), NOW)).toBe(false);
  });
});
