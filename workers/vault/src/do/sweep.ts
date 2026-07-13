// Expiry hygiene (FR-10): a DO alarm proactively refreshes grants expiring
// soon and marks unrefreshable ones unhealthy with a machine-readable
// reason. Rescheduled after every grant mutation and every run.
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDestination } from "../registry";
import { audit } from "./audit";
import type { TenantInstance } from "./instance";
import { markUnhealthy } from "./grants";
import { ensureFresh } from "./refresh";
import { grants, oauthState } from "./schema";

const DEFAULT_LEAD_S = 300;
/** Floor between now and the next alarm so a hot loop can't spin. */
const MIN_DELAY_MS = 5_000;

function leadMsFor(destId: string): number {
  return (getDestination(destId)?.refreshLeadSeconds ?? DEFAULT_LEAD_S) * 1000;
}

function refreshableRows(self: TenantInstance) {
  return self.db
    .select()
    .from(grants)
    .where(and(eq(grants.health, "ok"), eq(grants.kind, "oauth"), isNotNull(grants.expiresAt)))
    .all()
    .filter((r) => getDestination(r.dest)?.oauth?.refreshable === true);
}

/** Recompute and (re)arm the alarm from the earliest upcoming expiry. */
export function scheduleSweep(self: TenantInstance): void {
  const rows = refreshableRows(self);
  if (rows.length === 0) {
    void self.ctx.storage.deleteAlarm();
    return;
  }
  const nextWake = Math.min(...rows.map((r) => (r.expiresAt as number) - leadMsFor(r.dest)));
  void self.ctx.storage.setAlarm(Math.max(nextWake, Date.now() + MIN_DELAY_MS));
}

/** Alarm body. Refreshes near-expiry grants through the single-flight gate. */
export async function runSweep(self: TenantInstance): Promise<void> {
  const now = Date.now();
  for (const row of refreshableRows(self)) {
    const leadMs = leadMsFor(row.dest);
    if ((row.expiresAt as number) - leadMs > now) continue;
    const dest = getDestination(row.dest);
    if (!dest || !dest.enabled) continue;
    const result = await ensureFresh(self, dest, row, { horizonMs: leadMs });
    if (!result.ok) {
      // refreshGrant already marked permanent failures revoked_upstream;
      // anything still healthy after a sweep failure is a network-class
      // problem — surface it via health rather than failing silently forever.
      const current = self.db.select().from(grants).where(eq(grants.grantId, row.grantId)).get();
      if (current && current.health === "ok") {
        markUnhealthy(self, row.grantId, "network");
      }
      audit(self, { op: "sweep_refresh", outcome: result.error, dest: row.dest, label: row.label });
    } else {
      audit(self, { op: "sweep_refresh", outcome: "ok", dest: row.dest, label: row.label });
    }
  }
  // Expired OAuth states are dead weight — purge opportunistically.
  self.db.delete(oauthState).where(lt(oauthState.exp, now)).run();
  scheduleSweep(self);
}
