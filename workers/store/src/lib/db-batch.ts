// Standalone (no `cloudflare:workers` import) so unit-tier tests can load the
// modules that batch.
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "@/lib/db";

export type DbBatchItem = BatchItem<"sqlite">;

const isNonEmpty = (s: readonly DbBatchItem[]): s is readonly [DbBatchItem, ...DbBatchItem[]] =>
  s.length > 0;

/** `db.batch` over a dynamically-built statement list (drizzle's signature
 *  wants a non-empty tuple); no-op on empty. */
export async function runBatch(
  db: Db,
  statements: readonly DbBatchItem[],
): Promise<readonly { meta?: { changes?: number } }[]> {
  if (!isNonEmpty(statements)) return [];
  return await db.batch(statements);
}
