// The per-tenant Durable Object: ALL crypto happens here; plaintext
// credential material never crosses this boundary except getToken's scoped
// access material (NFR-3). One DO (and one private SQLite DB) per tenant —
// compromise of one tenant context exposes at most that tenant (NFR-2).
//
// The DO's identity is the tenant id: the entry worker resolves
// idFromName(tenantId) and passes tenantId on every call; the DO pins it in
// tenant_meta on first touch and hard-asserts equality forever after.
import { DurableObject } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { drizzle, type DrizzleSqliteDODatabase } from "drizzle-orm/durable-sqlite";
import { migrate } from "drizzle-orm/durable-sqlite/migrator";
import migrations from "../../migrations/migrations";
import type { Result } from "../result";
import type {
  AccessMaterial,
  GrantEnv,
  GrantMeta,
  InjectResult,
  InjectSpec,
  PutInput,
} from "../types";
import type { VaultEnv } from "../vault-env";
import { audit, readAudit, type AuditRow } from "./audit";
import * as grantOps from "./grants";
import type { Attribution, GrantRow, TenantInstance } from "./instance";
import * as oauthOps from "./oauth";
import * as rotateOps from "./rotate";
import * as schema from "./schema";
import { grants, oauthState, tenantMeta } from "./schema";
import * as spendOps from "./spend";
import { runSweep } from "./sweep";
import { revokeUpstream } from "./revoke";
import { getDestination } from "../registry";

export class VaultTenantDO extends DurableObject<VaultEnv> {
  declare __DURABLE_OBJECT_BRAND: never;
  db: DrizzleSqliteDODatabase<typeof schema>;
  /** Single-flight refresh registry (FR-9). In-memory: reset on eviction is harmless. */
  inflightRefresh: TenantInstance["inflightRefresh"] = new Map();
  /** Set per call from the entry worker's routing name; pinned in tenant_meta. */
  tenantId = "";

  constructor(ctx: DurableObjectState, env: VaultEnv) {
    super(ctx, env);
    this.db = drizzle(ctx.storage, { schema, logger: false });
    ctx.blockConcurrencyWhile(async () => {
      await migrate(this.db, migrations);
    });
  }

  get #self(): TenantInstance {
    return this as unknown as TenantInstance;
  }

  /**
   * Pin-or-assert the tenant identity. The entry worker derived this DO from
   * idFromName(tenantId), so a mismatch means a routing bug or a forged call
   * — fail loudly, never operate on another tenant's rows.
   */
  #enter(tenantId: string): TenantInstance {
    if (typeof tenantId !== "string" || tenantId.length === 0) {
      throw new Error("tenantId required");
    }
    const pinned = this.db.select().from(tenantMeta).where(eq(tenantMeta.key, "tenant_id")).get();
    if (!pinned) {
      this.db.insert(tenantMeta).values({ key: "tenant_id", value: tenantId }).run();
    } else if (pinned.value !== tenantId) {
      throw new Error("tenant identity mismatch — refusing to operate");
    }
    this.tenantId = tenantId;
    return this.#self;
  }

  // ── grants ───────────────────────────────────────────────────────────

  async put(input: PutInput, attr: Attribution): Promise<Result<GrantMeta, grantOps.PutError>> {
    return grantOps.put(this.#enter(input.tenantId), input, attr);
  }

  async list(input: { tenantId: string; dest?: string }, _attr: Attribution): Promise<GrantMeta[]> {
    return grantOps.list(this.#enter(input.tenantId), input.dest);
  }

  async del(
    input: { tenantId: string; dest: string; label?: string },
    attr: Attribution,
  ): Promise<Result<grantOps.DelOutcome, grantOps.DelError>> {
    return grantOps.del(this.#enter(input.tenantId), input, attr);
  }

  async setDefault(
    input: { tenantId: string; dest: string; label: string; confirmLive?: boolean },
    attr: Attribution,
  ): Promise<Result<GrantMeta, grantOps.SetDefaultError>> {
    return grantOps.setDefault(this.#enter(input.tenantId), input, attr);
  }

  // ── spend ────────────────────────────────────────────────────────────

  async getToken(
    input: { tenantId: string; dest: string; label?: string },
    attr: Attribution,
  ): Promise<Result<AccessMaterial, spendOps.GetTokenError>> {
    return spendOps.getToken(this.#enter(input.tenantId), input, attr);
  }

  async inject(
    input: { tenantId: string; dest: string; label?: string; request: InjectSpec },
    attr: Attribution,
  ): Promise<Result<InjectResult, spendOps.InjectError>> {
    return spendOps.inject(this.#enter(input.tenantId), input, attr);
  }

  // ── oauth ────────────────────────────────────────────────────────────

  async oauthBegin(
    input: {
      tenantId: string;
      dest: string;
      label: string;
      redirectUri: string;
      scopes?: string[];
      env?: GrantEnv;
    },
    attr: Attribution,
  ): Promise<Result<{ authorizeUrl: string }, oauthOps.OAuthBeginError>> {
    return oauthOps.oauthBegin(this.#enter(input.tenantId), input, attr);
  }

  async oauthCallback(
    input: { tenantId: string; code: string; state: string },
    attr: Attribution,
  ): Promise<Result<GrantMeta, oauthOps.OAuthCallbackError>> {
    return oauthOps.oauthCallback(this.#enter(input.tenantId), input, attr);
  }

  // ── admin ────────────────────────────────────────────────────────────

  async killTenant(input: { tenantId: string }, attr: Attribution): Promise<{ grants: number }> {
    const self = this.#enter(input.tenantId);
    const rows: GrantRow[] = this.db.select().from(grants).all();
    for (const row of rows) {
      const dest = getDestination(row.dest);
      if (!dest?.revoke) continue;
      const opened = await grantOps.openGrantRow(self, row);
      if (opened.ok) await revokeUpstream(self, dest, opened.value);
    }
    this.db.delete(grants).run();
    this.db.delete(oauthState).run();
    await this.ctx.storage.deleteAlarm();
    audit(self, { op: "kill_tenant", outcome: "ok", ...attr });
    return { grants: rows.length };
  }

  async rotateKek(
    input: { tenantId: string; toVersion?: number },
    attr: Attribution,
  ): Promise<Result<rotateOps.RotateOutcome, rotateOps.RotateError>> {
    return rotateOps.rotateKek(this.#enter(input.tenantId), input, attr);
  }

  async auditRecent(
    input: { tenantId: string; limit?: number },
    _attr: Attribution,
  ): Promise<AuditRow[]> {
    return readAudit(this.#enter(input.tenantId), input.limit);
  }

  // ── alarm (FR-10) ────────────────────────────────────────────────────

  override async alarm(): Promise<void> {
    // The alarm has no caller-provided tenant id; recover it from the pin.
    const pinned = this.db.select().from(tenantMeta).where(eq(tenantMeta.key, "tenant_id")).get();
    if (!pinned) return; // never touched — nothing to sweep
    this.tenantId = pinned.value;
    await runSweep(this.#self);
  }
}
