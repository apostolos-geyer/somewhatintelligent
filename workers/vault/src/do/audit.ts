// Rolling recent-audit window (FR-14). Events are typed with NO value
// fields — secret-freedom by construction, not by discipline. Long-term
// retention is the entry worker's canonical logs (Logpush).
import { desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import type { TenantInstance } from "./instance";
import { auditRecent } from "./schema";

const WINDOW = 500;

export interface AuditEvent {
  op: string;
  outcome: string;
  dest?: string;
  label?: string;
  callerApp?: string;
}

export function audit(self: TenantInstance, ev: AuditEvent): void {
  self.db
    .insert(auditRecent)
    .values({
      ts: Date.now(),
      op: ev.op,
      outcome: ev.outcome,
      dest: ev.dest ?? null,
      label: ev.label ?? null,
      callerApp: ev.callerApp ?? null,
    })
    .run();
  // Keep the newest WINDOW rows.
  self.db.run(
    sql`DELETE FROM audit_recent WHERE id NOT IN (SELECT id FROM audit_recent ORDER BY id DESC LIMIT ${WINDOW})`,
  );
}

export interface AuditRow {
  ts: number;
  op: string;
  outcome: string;
  dest: string | null;
  label: string | null;
  callerApp: string | null;
}

export function readAudit(self: TenantInstance, limit = 100): AuditRow[] {
  const capped = Math.min(Math.max(limit, 1), WINDOW);
  return self.db
    .select({
      ts: auditRecent.ts,
      op: auditRecent.op,
      outcome: auditRecent.outcome,
      dest: auditRecent.dest,
      label: auditRecent.label,
      callerApp: auditRecent.callerApp,
    })
    .from(auditRecent)
    .orderBy(desc(auditRecent.id))
    .limit(capped)
    .all();
}
