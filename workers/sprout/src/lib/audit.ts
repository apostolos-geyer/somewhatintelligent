/**
 * Append-only audit log writer (INV: no code path UPDATEs/DELETEs audit_log).
 * EVERY mutation server fn calls `writeAudit(...)` in the same logical operation
 * as the mutation it records. In local dev (`audit.sink === "console"`) the row
 * is also console-logged for visibility.
 */
import { env } from "cloudflare:workers";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { auditLog } from "@/schema";
import { loadConfig } from "@/lib/config";

export interface AuditEntry {
  brandId: string | null;
  action: string; // dotted verb, e.g. "drop.upsert" / "review.delete"
  actorId: string;
  targetType?: string;
  targetId?: string;
  meta?: Record<string, unknown>;
}

export async function writeAudit(entry: AuditEntry): Promise<void> {
  const cfg = loadConfig({
    ENVIRONMENT: (env as { ENVIRONMENT?: string }).ENVIRONMENT ?? "development",
  });
  if (cfg.audit.sink === "console") {
    console.log(
      `[audit] ${entry.action} actor=${entry.actorId} ` +
        `target=${entry.targetType ?? "-"}:${entry.targetId ?? "-"} brand=${entry.brandId ?? "-"}`,
    );
  }
  const db = createDb(env.DB);
  await db.insert(auditLog).values({
    id: ulid(),
    brandId: entry.brandId,
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    metaJson: JSON.stringify(entry.meta ?? {}),
    createdAt: Date.now(),
  });
}
