// KEK rotation (FR-13, §7): per grant — unwrap DEK with its current KEK,
// rewrap under the target KEK, re-seal the payload under the target-version
// AAD (see crypto/envelope.ts for why the PRD's "ciphertext untouched" can't
// coexist with kekVersion-bound AAD), verify a full decrypt round-trip, then
// replace the row's crypto columns in one UPDATE (crash-atomic).
//
// Resumability needs no cursor: the `kek_version != target` predicate makes
// every call converge — a killed batch leaves already-rotated rows filtered
// out of the next run, and a half-processed grant was never UPDATEd.
import { and, eq, ne, not } from "drizzle-orm";
import { openPayload, sealPayload, unwrapDek, wrapDek } from "../crypto/envelope";
import { activeKekVersion, loadKek } from "../crypto/keys";
import { err, ok, type Result } from "../result";
import type { GrantEnv } from "../types";
import { audit } from "./audit";
import { markUnhealthy } from "./grants";
import type { Attribution, GrantRow, TenantInstance } from "./instance";
import { grants } from "./schema";

const BATCH = 25;

export interface RotateOutcome {
  done: boolean;
  rewrapped: number;
  remaining: number;
  kekVersion: number;
}

export type RotateError = "kek_unavailable";

export async function rotateKek(
  self: TenantInstance,
  input: { toVersion?: number },
  attr: Attribution,
): Promise<Result<RotateOutcome, RotateError>> {
  const target = input.toVersion ?? activeKekVersion(self.env);
  let targetKek: CryptoKey;
  try {
    targetKek = await loadKek(self.env, target);
  } catch (e) {
    return err("kek_unavailable", e instanceof Error ? e.message : "target KEK missing");
  }

  // Tampered rows can never decrypt under any epoch — they'd wedge the
  // rotation as permanently-remaining. They're already surfaced via health;
  // exclude them here so `done` means "every rewrappable grant is rewrapped".
  const pending = and(
    ne(grants.kekVersion, target),
    not(and(eq(grants.health, "unhealthy"), eq(grants.unhealthyReason, "tampered"))!),
  );
  const batch = self.db.select().from(grants).where(pending).limit(BATCH).all();
  let rewrapped = 0;
  for (const row of batch) {
    const done = await rotateGrant(self, row, target, targetKek);
    if (done) rewrapped++;
  }
  const remaining = self.db.select().from(grants).where(pending).all().length;
  audit(self, { op: "rotate_kek", outcome: remaining === 0 ? "ok" : "partial", ...attr });
  return ok({ done: remaining === 0, rewrapped, remaining, kekVersion: target });
}

async function rotateGrant(
  self: TenantInstance,
  row: GrantRow,
  target: number,
  targetKek: CryptoKey,
): Promise<boolean> {
  const env = (row.env as GrantEnv | null) ?? null;
  const oldAad = {
    tenantId: self.tenantId,
    dest: row.dest,
    label: row.label,
    env,
    grantId: row.grantId,
    kekVersion: row.kekVersion,
  };
  const newAad = { ...oldAad, kekVersion: target };
  try {
    const oldKek = await loadKek(self.env, row.kekVersion);
    // Extractable transiently — required to rewrap; scope ends this function.
    const dek = await unwrapDek(new Uint8Array(row.dekWrapped), oldKek, { extractable: true });
    const payload = await openPayload(
      { ciphertext: new Uint8Array(row.ciphertext), iv: new Uint8Array(row.iv) },
      dek,
      oldAad,
    );
    const newWrapped = await wrapDek(dek, targetKek);
    const resealed = await sealPayload(payload, dek, newAad);

    // Two-phase: verify the new wrap + ciphertext round-trip BEFORE the write.
    const verifyDek = await unwrapDek(newWrapped, targetKek);
    await openPayload(resealed, verifyDek, newAad);

    self.db
      .update(grants)
      .set({
        dekWrapped: Buffer.from(newWrapped),
        ciphertext: Buffer.from(resealed.ciphertext),
        iv: Buffer.from(resealed.iv),
        kekVersion: target,
      })
      .where(eq(grants.grantId, row.grantId))
      .run();
    return true;
  } catch {
    // Undecryptable under its recorded epoch: tampered or orphaned. Surface
    // via health rather than wedging the whole rotation.
    markUnhealthy(self, row.grantId, "tampered");
    audit(self, { op: "rotate_kek", outcome: "grant_tampered", dest: row.dest, label: row.label });
    return false;
  }
}
