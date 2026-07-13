// Per-tenant DO SQLite schema (PRD §8). One database per tenant DO — there
// is no cross-tenant table anywhere in vault (NFR-2).
import { sql } from "drizzle-orm";
import { blob, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const grants = sqliteTable(
  "grants",
  {
    grantId: text("grant_id").primaryKey(),
    dest: text("dest").notNull(),
    /** Tenant-chosen slug: live, sandbox, acme-account, ... */
    label: text("label").notNull(),
    /** live | test | NULL. Immutable per grant (FR-19), AAD-bound (§7). */
    env: text("env"),
    isDefault: integer("is_default").notNull().default(0),
    /** oauth | api_key | pat */
    kind: text("kind").notNull(),
    /** AES-256-GCM(payload, DEK, AAD) */
    ciphertext: blob("ciphertext", { mode: "buffer" }).notNull(),
    iv: blob("iv", { mode: "buffer" }).notNull(),
    /** AES-KW(DEK, KEK[kek_version]) */
    dekWrapped: blob("dek_wrapped", { mode: "buffer" }).notNull(),
    kekVersion: integer("kek_version").notNull(),
    /** JSON array — metadata duplicate for list(); authoritative copy is in the payload. */
    scopes: text("scopes").notNull(),
    /** Access-token expiry hint, ms epoch (metadata). */
    expiresAt: integer("expires_at"),
    health: text("health").notNull().default("ok"),
    unhealthyReason: text("unhealthy_reason"),
    createdAt: integer("created_at").notNull(),
    lastUsedAt: integer("last_used_at"),
  },
  (t) => [
    uniqueIndex("grants_dest_label").on(t.dest, t.label),
    // At most one default per destination (FR-16).
    uniqueIndex("grants_dest_default")
      .on(t.dest)
      .where(sql`is_default = 1`),
  ],
);

export const oauthState = sqliteTable("oauth_state", {
  /** Single-use: row is deleted on first successful verify (FR-2). */
  nonce: text("nonce").primaryKey(),
  dest: text("dest").notNull(),
  label: text("label").notNull(),
  env: text("env"),
  /** JSON array of requested scopes. */
  scopes: text("scopes").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  /** ms epoch expiry (10-minute TTL). */
  exp: integer("exp").notNull(),
});

// Rolling recent-audit window (FR-14); long-term retention is the entry
// worker's canonical logs via Logpush. NO value fields by construction.
export const auditRecent = sqliteTable("audit_recent", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ts: integer("ts").notNull(),
  dest: text("dest"),
  label: text("label"),
  op: text("op").notNull(),
  outcome: text("outcome").notNull(),
  callerApp: text("caller_app"),
});

/** Pins the owning tenant id on first write; ops assert it thereafter. */
export const tenantMeta = sqliteTable("tenant_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
