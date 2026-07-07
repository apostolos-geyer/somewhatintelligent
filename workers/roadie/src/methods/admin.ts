// Administrative methods. Authorization is the caller's responsibility: v1's
// trust boundary is the service binding, so whichever consumer Worker holds
// an admin surface must check the admin role before invoking. With the owner
// model retired, the usage/list surface no longer partitions by any key —
// consumer apps track user-level quotas in their own databases.
import { count, desc, eq, gt, isNull, sum } from "drizzle-orm";
import { ADMIN_LIST_DEFAULT_LIMIT, ADMIN_LIST_MAX_LIMIT } from "../config";
import { createDb } from "../db";
import { newId } from "../ids";
import { requireRequestLog } from "@greenroom/kit/log";
import { type RoadieInstance } from "../log";
import { validateMeta } from "../meta";
import { err, ok, type Result } from "../result";
import { blobReference, deletionQueue, physicalBlob } from "../schema";

// ---------- adminUsage ----------

export type AdminUsageValue = { bytes: number; blobCount: number };

// Aggregate byte usage + blob count across the entire service. Used by
// operator dashboards; per-user or per-app accounting is retired along with
// the owner model (consumer apps enforce their own quotas).
export async function adminUsage(
  roadie: RoadieInstance,
  _input: Record<string, never>,
  rawMeta: unknown,
): Promise<Result<AdminUsageValue, never>> {
  validateMeta(rawMeta);
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({ bytes: sum(physicalBlob.size), blobCount: count() })
    .from(physicalBlob)
    .where(isNull(physicalBlob.deletedAt));
  const bytes = row?.bytes;
  return ok({
    bytes: typeof bytes === "string" ? Number(bytes) : (bytes ?? 0),
    blobCount: row?.blobCount ?? 0,
  });
}

// ---------- adminListBlobs ----------

export type AdminListBlobsInput = { limit?: number; cursor?: string };
export type AdminListBlobsError = "invalid_cursor";
export type AdminListBlobsValue = {
  blobs: Array<{
    blobId: string;
    hash: string;
    size: number;
    state: "pending" | "ready" | "deleted";
    refcount: number;
    createdAt: number;
  }>;
  nextCursor: string | null;
};

// Cursor is a unix-ms timestamp emitted as a plain numeric string. Opaque to
// callers (they just round-trip it), but transparent to anyone poking at logs.
function decodeCursor(s: string): number | null {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function encodeCursor(createdAtMs: number): string {
  return String(createdAtMs);
}

export async function adminListBlobs(
  roadie: RoadieInstance,
  input: AdminListBlobsInput,
  rawMeta: unknown,
): Promise<Result<AdminListBlobsValue, AdminListBlobsError>> {
  validateMeta(rawMeta);
  const limit = Math.min(input.limit ?? ADMIN_LIST_DEFAULT_LIMIT, ADMIN_LIST_MAX_LIMIT);
  let olderThanMs: number | null = null;
  if (input.cursor !== undefined) {
    const decoded = decodeCursor(input.cursor);
    if (decoded === null) return err("invalid_cursor");
    olderThanMs = decoded;
  }

  const db = createDb(roadie.env.DB);
  const where =
    olderThanMs !== null ? gt(physicalBlob.createdAt, new Date(olderThanMs)) : undefined;
  const rows = await db
    .select({
      blobId: physicalBlob.id,
      hash: physicalBlob.hash,
      size: physicalBlob.size,
      refcount: physicalBlob.refcount,
      finalizedAt: physicalBlob.finalizedAt,
      deletedAt: physicalBlob.deletedAt,
      createdAt: physicalBlob.createdAt,
    })
    .from(physicalBlob)
    .where(where)
    .orderBy(desc(physicalBlob.createdAt))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map((r) => ({
    blobId: r.blobId,
    hash: r.hash,
    size: r.size,
    refcount: r.refcount,
    state:
      r.deletedAt !== null
        ? ("deleted" as const)
        : r.finalizedAt !== null
          ? ("ready" as const)
          : ("pending" as const),
    createdAt: r.createdAt.getTime(),
  }));
  const nextCursor =
    rows.length > limit
      ? encodeCursor((page[page.length - 1] as { createdAt: number }).createdAt)
      : null;
  return ok({ blobs: page, nextCursor });
}

// ---------- adminForceDelete ----------

export type AdminForceDeleteInput = { blobId: string };
export type AdminForceDeleteError = "not_found";

// Operator escape hatch. Tears down a physical blob and all references to
// it. Intended for abuse response and accidental-upload cleanup — never
// part of the normal lifecycle.
export async function adminForceDelete(
  roadie: RoadieInstance,
  input: AdminForceDeleteInput,
  rawMeta: unknown,
): Promise<Result<null, AdminForceDeleteError>> {
  validateMeta(rawMeta);
  requireRequestLog().add({ blob_id: input.blobId });
  const db = createDb(roadie.env.DB);
  const [row] = await db
    .select({ id: physicalBlob.id })
    .from(physicalBlob)
    .where(eq(physicalBlob.id, input.blobId))
    .limit(1);
  if (!row) return err("not_found");

  const now = new Date();
  await db.batch([
    db.delete(blobReference).where(eq(blobReference.physicalBlobId, input.blobId)),
    db
      .update(physicalBlob)
      .set({ deletedAt: now, refcount: 0 })
      .where(eq(physicalBlob.id, input.blobId)),
  ]);
  roadie.ctx.waitUntil(
    roadie.env.BLOBS.delete(input.blobId).catch(async (e: unknown) => {
      const message = e instanceof Error ? e.message : String(e);
      const db2 = createDb(roadie.env.DB);
      await db2
        .insert(deletionQueue)
        .values({
          id: newId(),
          physicalBlobId: input.blobId,
          attempts: 1,
          nextAttemptAt: new Date(Date.now() + 60 * 60 * 1000),
          lastError: message.slice(0, 500),
          createdAt: new Date(),
        })
        .onConflictDoNothing();
    }),
  );
  return ok(null);
}

// ---------- adminTriggerTask ----------

export type ScheduledTaskName = "pending_reap" | "zero_ref_reap" | "deletion_drain" | "reconcile";

export type AdminTriggerTaskInput = { task: ScheduledTaskName };
export type AdminTriggerTaskError = "task_running";
export type AdminTriggerTaskValue = {
  processed: number;
  durationMs: number;
  status?: "deferred";
};

// Isolate-local concurrency guard. This prevents a single Worker isolate from
// running the same scheduled task twice in parallel (e.g. an operator trigger
// landing on the same isolate as a cron firing). It does NOT coordinate
// across isolates — if two isolates both receive a trigger for the same task
// concurrently, both will run. At v1 scale this is acceptable because the
// scheduled tasks are themselves idempotent (bounded-batch selects the next
// N rows, processes them, exits); at worst two firings split a batch. If
// cross-isolate coordination becomes necessary, this moves to a durable
// object or a D1-backed lease.
const running = new Set<ScheduledTaskName>();

export async function adminTriggerTask(
  roadie: RoadieInstance,
  input: AdminTriggerTaskInput,
  rawMeta: unknown,
): Promise<Result<AdminTriggerTaskValue, AdminTriggerTaskError>> {
  validateMeta(rawMeta);
  const log = requireRequestLog();
  log.add({ task: input.task });
  if (running.has(input.task)) return err("task_running");
  running.add(input.task);
  try {
    const mod = await loadTask(input.task);
    const started = Date.now();
    const result = await mod.run(roadie.env, roadie.ctx);
    log.add({ processed: result.processed, task_duration_ms: Date.now() - started });
    return ok(result);
  } finally {
    running.delete(input.task);
  }
}

type ScheduledModule = {
  run(env: RoadieInstance["env"], ctx: RoadieInstance["ctx"]): Promise<AdminTriggerTaskValue>;
};

async function loadTask(task: ScheduledTaskName): Promise<ScheduledModule> {
  switch (task) {
    case "pending_reap":
      return (await import("../scheduled/pending-reap")) as ScheduledModule;
    case "zero_ref_reap":
      return (await import("../scheduled/zero-ref-reap")) as ScheduledModule;
    case "deletion_drain":
      return (await import("../scheduled/deletion-drain")) as ScheduledModule;
    case "reconcile":
      return (await import("../scheduled/reconcile")) as ScheduledModule;
  }
}
