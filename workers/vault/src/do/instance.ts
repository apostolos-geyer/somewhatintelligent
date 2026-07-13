// Narrow view of VaultTenantDO that the do/* helper modules operate on
// (mirrors roadie's RoadieInstance pattern — helpers take `self` first).
import type { DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import type { Result } from "../result";
import type { VaultEnv } from "../vault-env";
import type * as schema from "./schema";

export type GrantRow = typeof schema.grants.$inferSelect;

/** Per-call attribution forwarded by the entry worker. Audit-only. */
export interface Attribution {
  callerApp: string;
}

export interface TenantInstance {
  ctx: DurableObjectState;
  env: VaultEnv;
  db: DrizzleSqliteDODatabase<typeof schema>;
  /** The DO's identity, passed on every call and pinned in tenant_meta. */
  tenantId: string;
  /** Single-flight refresh registry, keyed by grantId (PRD FR-9). */
  inflightRefresh: Map<string, Promise<Result<GrantRow, "refresh_failed" | "grant_unhealthy">>>;
}
