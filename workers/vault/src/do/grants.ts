// Grant storage ops: put / list / del / setDefault, spend-time selection
// (FR-16/17/18), and the row-level seal/open helpers shared by spend,
// refresh, rotation, and the OAuth callback. All plaintext material in this
// module is function-scoped (NFR-3).
import { and, asc, eq } from "drizzle-orm";
import type { AadParts } from "../crypto/aad";
import {
  generateDek,
  importDek,
  openPayload,
  sealPayload,
  unwrapDek,
  wrapDek,
  type GrantPayload,
} from "../crypto/envelope";
import { activeKekVersion, loadKek } from "../crypto/keys";
import type { VaultErrorCode } from "../errors";
import { err, ok, type Result } from "../result";
import { getDestination, type Destination } from "../registry";
import {
  LABEL_RE,
  type GrantEnv,
  type GrantMeta,
  type PutInput,
  type PutMaterial,
  type UnhealthyReason,
} from "../types";
import { audit } from "./audit";
import type { Attribution, GrantRow, TenantInstance } from "./instance";
import { grants } from "./schema";
import { scheduleSweep } from "./sweep";
import { revokeUpstream } from "./revoke";

// ── row helpers ────────────────────────────────────────────────────────

export function rowToMeta(row: GrantRow): GrantMeta {
  return {
    grantId: row.grantId,
    dest: row.dest,
    label: row.label,
    env: (row.env as GrantEnv | null) ?? null,
    kind: row.kind as GrantMeta["kind"],
    isDefault: row.isDefault === 1,
    scopes: JSON.parse(row.scopes) as string[],
    health: row.health as GrantMeta["health"],
    unhealthyReason: (row.unhealthyReason as UnhealthyReason | null) ?? null,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * The AAD tuple binding a grant row to its ciphertext (§7). Exported so the
 * refresh and rotation paths derive it the SAME way — this invariant must
 * never drift across the three re-seal sites. `kekVersion` defaults to the
 * row's current epoch; rotation passes the target epoch.
 */
export function aadFor(self: TenantInstance, row: GrantRow, kekVersion?: number): AadParts {
  return {
    tenantId: self.tenantId,
    dest: row.dest,
    label: row.label,
    env: (row.env as GrantEnv | null) ?? null,
    grantId: row.grantId,
    kekVersion: kekVersion ?? row.kekVersion,
  };
}

export function destGrants(self: TenantInstance, dest: string): GrantRow[] {
  return self.db
    .select()
    .from(grants)
    .where(eq(grants.dest, dest))
    .orderBy(asc(grants.label))
    .all();
}

export function grantByRef(
  self: TenantInstance,
  dest: string,
  label: string,
): GrantRow | undefined {
  return self.db
    .select()
    .from(grants)
    .where(and(eq(grants.dest, dest), eq(grants.label, label)))
    .get();
}

/**
 * Decrypt a grant row. Any authentication failure (flipped ciphertext byte,
 * AAD mismatch from row tampering, wrong-epoch wrap) marks the grant
 * unhealthy(tampered) — never silently skipped — and fails the op.
 */
export async function openGrantRow(
  self: TenantInstance,
  row: GrantRow,
): Promise<Result<GrantPayload, "grant_unhealthy">> {
  try {
    const kek = await loadKek(self.env, row.kekVersion);
    const dek = await unwrapDek(new Uint8Array(row.dekWrapped), kek);
    const payload = await openPayload(
      { ciphertext: new Uint8Array(row.ciphertext), iv: new Uint8Array(row.iv) },
      dek,
      aadFor(self, row),
    );
    return ok(payload);
  } catch {
    markUnhealthy(self, row.grantId, "tampered");
    return err(
      "grant_unhealthy",
      `grant ${row.dest}/${row.label} failed authentication (tampered)`,
    );
  }
}

/** Seal a payload into fresh row crypto columns under the active KEK. */
export async function sealGrantColumns(
  self: TenantInstance,
  aad: AadParts,
  payload: GrantPayload,
): Promise<{ ciphertext: Buffer; iv: Buffer; dekWrapped: Buffer; kekVersion: number }> {
  const kek = await loadKek(self.env, aad.kekVersion);
  const dekRaw = generateDek();
  const dek = await importDek(dekRaw);
  const dekWrapped = await wrapDek(dek, kek);
  const sealed = await sealPayload(payload, dek, aad);
  return {
    ciphertext: Buffer.from(sealed.ciphertext),
    iv: Buffer.from(sealed.iv),
    dekWrapped: Buffer.from(dekWrapped),
    kekVersion: aad.kekVersion,
  };
}

export function markUnhealthy(
  self: TenantInstance,
  grantId: string,
  reason: UnhealthyReason,
): void {
  self.db
    .update(grants)
    .set({ health: "unhealthy", unhealthyReason: reason })
    .where(eq(grants.grantId, grantId))
    .run();
}

// ── env resolution (FR-1) ──────────────────────────────────────────────

function inferEnv(dest: Destination, secret: string): GrantEnv | null {
  const p = dest.envInferPrefixes;
  if (!p) return null;
  if (p.live.some((prefix) => secret.startsWith(prefix))) return "live";
  if (p.test.some((prefix) => secret.startsWith(prefix))) return "test";
  return null;
}

function secretOf(material: PutMaterial): string {
  switch (material.kind) {
    case "api_key":
      return material.apiKey;
    case "pat":
      return material.token;
    case "oauth":
      return material.accessToken;
  }
}

export function resolveEnv(
  dest: Destination,
  declared: GrantEnv | undefined,
  material: PutMaterial,
): Result<GrantEnv | null, "env_required" | "env_mismatch"> {
  const inferred = inferEnv(dest, secretOf(material));
  if (declared && inferred && declared !== inferred) {
    return err("env_mismatch", `declared env "${declared}" but material infers "${inferred}"`);
  }
  const env = declared ?? inferred;
  if (dest.envSensitive && !env) {
    return err("env_required", `destination "${dest.id}" is env-sensitive: declare env live|test`);
  }
  return ok(env ?? null);
}

// ── destination gate shared by every op ────────────────────────────────

export function requireDest(destId: string): Result<Destination, "dest_unknown" | "dest_disabled"> {
  const dest = getDestination(destId);
  if (!dest) return err("dest_unknown", `unknown destination "${destId}"`);
  if (!dest.enabled) return err("dest_disabled", `destination "${destId}" is disabled`);
  return ok(dest);
}

// ── put (FR-1, FR-19) ──────────────────────────────────────────────────

export type PutError = Extract<
  VaultErrorCode,
  | "dest_unknown"
  | "dest_disabled"
  | "label_invalid"
  | "material_mismatch"
  | "env_required"
  | "env_mismatch"
  | "env_immutable"
>;

export async function put(
  self: TenantInstance,
  input: PutInput,
  attr: Attribution,
): Promise<Result<GrantMeta, PutError>> {
  // Audit validation failures too, so the rolling window matches the spend
  // paths (which audit every branch) rather than only recording put successes.
  const fail = <E extends PutError>(e: { ok: false; error: E; message?: string }) => {
    audit(self, { op: "put", outcome: e.error, dest: input.dest, label: input.label, ...attr });
    return e;
  };

  const destR = requireDest(input.dest);
  if (!destR.ok) return fail(destR);
  const dest = destR.value;
  if (!LABEL_RE.test(input.label)) {
    return fail(err("label_invalid", "label must be a 1-32 char slug: [a-z0-9][a-z0-9-]*"));
  }
  if (input.material.kind !== dest.kind) {
    return fail(
      err(
        "material_mismatch",
        `destination "${dest.id}" expects ${dest.kind} material, got ${input.material.kind}`,
      ),
    );
  }
  const envR = resolveEnv(dest, input.env, input.material);
  if (!envR.ok) return fail(envR);
  const env = envR.value;

  const existing = grantByRef(self, input.dest, input.label);
  // Env is immutable per grant (FR-19): the path across env is put a new
  // label and del the old.
  if (existing && (existing.env ?? null) !== env) {
    return fail(
      err(
        "env_immutable",
        `grant ${input.dest}/${input.label} is pinned to env "${existing.env ?? "none"}"`,
      ),
    );
  }

  const now = Date.now();
  const grantId = existing?.grantId ?? crypto.randomUUID();
  const payload = materialToPayload(input.material, now);
  const sealedCols = await sealGrantColumns(
    self,
    {
      tenantId: self.tenantId,
      dest: input.dest,
      label: input.label,
      env,
      grantId,
      kekVersion: activeKekVersion(self.env),
    },
    payload,
  );

  const common = {
    ...sealedCols,
    kind: input.material.kind,
    scopes: JSON.stringify(payload.scopes),
    expiresAt: payload.expiresAt ?? null,
    health: "ok",
    unhealthyReason: null,
  };
  if (existing) {
    self.db.update(grants).set(common).where(eq(grants.grantId, grantId)).run();
  } else {
    self.db
      .insert(grants)
      .values({
        ...common,
        grantId,
        dest: input.dest,
        label: input.label,
        env,
        isDefault: 0,
        createdAt: now,
        lastUsedAt: null,
      })
      .run();
  }
  audit(self, { op: "put", outcome: "ok", dest: input.dest, label: input.label, ...attr });
  scheduleSweep(self);
  const row = grantByRef(self, input.dest, input.label);
  if (!row) throw new Error("put: row vanished after write");
  return ok(rowToMeta(row));
}

function materialToPayload(material: PutMaterial, now: number): GrantPayload {
  switch (material.kind) {
    case "api_key":
      return { kind: "api_key", apiKey: material.apiKey, scopes: [], obtainedAt: now };
    case "pat":
      return { kind: "pat", apiKey: material.token, scopes: [], obtainedAt: now };
    case "oauth":
      return {
        kind: "oauth",
        accessToken: material.accessToken,
        ...(material.refreshToken !== undefined && { refreshToken: material.refreshToken }),
        scopes: material.scopes ?? [],
        obtainedAt: now,
        ...(material.expiresAt !== undefined && { expiresAt: material.expiresAt }),
      };
  }
}

// ── list (FR-4) ────────────────────────────────────────────────────────

export function list(self: TenantInstance, dest?: string): GrantMeta[] {
  const rows = dest
    ? destGrants(self, dest)
    : self.db.select().from(grants).orderBy(asc(grants.dest), asc(grants.label)).all();
  return rows.map(rowToMeta);
}

// ── del (FR-3) ─────────────────────────────────────────────────────────

export type DelOutcome =
  | { deleted: true; revokedUpstream: boolean }
  | { deleted: false; labels: string[] };

export type DelError = Extract<VaultErrorCode, "dest_unknown">;

export async function del(
  self: TenantInstance,
  input: { dest: string; label?: string },
  attr: Attribution,
): Promise<Result<DelOutcome, DelError>> {
  // Deliberately NOT gated on dest.enabled: a killed destination must not
  // block credential destruction. Unknown dests still resolve for cleanup.
  const dest = getDestination(input.dest);
  if (!dest) return err("dest_unknown", `unknown destination "${input.dest}"`);

  // No label: delete nothing, return what exists (FR-3 — no bulk-by-accident).
  if (input.label === undefined) {
    const labels = destGrants(self, input.dest).map((r) => r.label);
    return ok({ deleted: false, labels });
  }

  const row = grantByRef(self, input.dest, input.label);
  if (!row) {
    // Idempotent: deleting an absent grant succeeds.
    audit(self, { op: "del", outcome: "ok", dest: input.dest, label: input.label, ...attr });
    return ok({ deleted: true, revokedUpstream: false });
  }

  let revokedUpstream = false;
  if (dest.revoke) {
    const payload = await openGrantRow(self, row);
    if (payload.ok) {
      revokedUpstream = await revokeUpstream(self, dest, payload.value);
    }
  }
  self.db.delete(grants).where(eq(grants.grantId, row.grantId)).run();
  audit(self, {
    op: "del",
    outcome: revokedUpstream ? "ok_revoked" : "ok",
    dest: input.dest,
    label: input.label,
    ...attr,
  });
  scheduleSweep(self);
  return ok({ deleted: true, revokedUpstream });
}

// ── setDefault (FR-16/17) ──────────────────────────────────────────────

export type SetDefaultError = Extract<
  VaultErrorCode,
  "dest_unknown" | "dest_disabled" | "grant_missing" | "confirm_live_required"
>;

export function setDefault(
  self: TenantInstance,
  input: { dest: string; label: string; confirmLive?: boolean },
  attr: Attribution,
): Result<GrantMeta, SetDefaultError> {
  const destR = requireDest(input.dest);
  if (!destR.ok) return destR;
  const dest = destR.value;
  const row = grantByRef(self, input.dest, input.label);
  if (!row) {
    const labels = destGrants(self, input.dest).map((r) => r.label);
    return err("grant_missing", `no grant ${input.dest}/${input.label}`, labels);
  }
  // Making a live grant the implicit spend target requires explicit intent.
  if (dest.envSensitive && row.env === "live" && input.confirmLive !== true) {
    return err(
      "confirm_live_required",
      `setting a live grant as default requires confirmLive: true`,
    );
  }
  // Clear-then-set; the partial unique index enforces at most one default.
  self.db.update(grants).set({ isDefault: 0 }).where(eq(grants.dest, input.dest)).run();
  self.db.update(grants).set({ isDefault: 1 }).where(eq(grants.grantId, row.grantId)).run();
  audit(self, { op: "set_default", outcome: "ok", dest: input.dest, label: input.label, ...attr });
  const updated = grantByRef(self, input.dest, input.label);
  if (!updated) throw new Error("setDefault: row vanished");
  return ok(rowToMeta(updated));
}

// ── spend-time selection (FR-16/17/18) ─────────────────────────────────

export type SelectError = Extract<
  VaultErrorCode,
  "grant_missing" | "grant_ambiguous" | "live_requires_explicit_label" | "grant_unhealthy"
>;

export function selectGrant(
  self: TenantInstance,
  dest: Destination,
  label: string | undefined,
): Result<GrantRow, SelectError> {
  const rows = destGrants(self, dest.id);
  const labels = rows.map((r) => r.label);

  let candidate: GrantRow | undefined;
  if (label !== undefined) {
    candidate = rows.find((r) => r.label === label);
    if (!candidate) {
      return err("grant_missing", `no grant ${dest.id}/${label}`, labels);
    }
  } else {
    if (rows.length === 0) return err("grant_missing", `no grants for ${dest.id}`, []);
    const dflt = rows.find((r) => r.isDefault === 1);
    candidate = dflt ?? (rows.length === 1 ? rows[0] : undefined);
    if (!candidate) {
      return err("grant_ambiguous", `label required: ${dest.id} has ${rows.length} grants`, labels);
    }
    // Live grants are never selected implicitly (FR-17). A default is exempt:
    // pointing the default at a live grant already required confirmLive.
    if (!dflt && dest.envSensitive && candidate.env === "live") {
      return err(
        "live_requires_explicit_label",
        `${dest.id}/${candidate.label} is a live grant — spend it by explicit label`,
        labels,
      );
    }
  }
  // No cross-label fallback (FR-18): an unhealthy selection fails with that
  // fact; siblings are never consulted.
  if (candidate.health !== "ok") {
    return err(
      "grant_unhealthy",
      `grant ${dest.id}/${candidate.label} is unhealthy (${candidate.unhealthyReason ?? "unknown"})`,
    );
  }
  return ok(candidate);
}

export function touchLastUsed(self: TenantInstance, grantId: string): void {
  self.db.update(grants).set({ lastUsedAt: Date.now() }).where(eq(grants.grantId, grantId)).run();
}
