/**
 * D1 integration: the media GC drain (T18, RFC-0001 D10 / INV-DEL-4) against a
 * REAL local D1. A hard delete commits a `media_gc_outbox` row; this sweep asks
 * the injected `MediaStorage` port to delete the bytes and settles the row. A
 * successful delete OR a `not_found` removes the row; an `unavailable` result (or
 * a thrown error) increments `attempts`, records `last_error`, and defers the
 * row on an exponential backoff so a wedged backend never restores eligibility.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { asc, eq } from "drizzle-orm";

import * as schema from "@/schema";
import type { MediaStorage, StorageResult } from "@/lib/media-storage";
import { drainMediaGc } from "@/lib/media-gc";

const db = drizzle(env.DB, { schema });
const { mediaGcOutbox } = schema;

// A delete-only storage stub that records the keys it saw and answers per-key
// from a script (default: success). `read`/`put` are unused by the drain.
function stubStorage(script: Record<string, StorageResult<void>> = {}): {
  storage: Pick<MediaStorage, "delete">;
  seen: string[];
} {
  const seen: string[] = [];
  return {
    seen,
    storage: {
      async delete({ key }) {
        seen.push(key);
        return script[key] ?? { ok: true, value: undefined };
      },
    },
  };
}

async function enqueue(id: string, storageKey: string, nextAttemptAt = 0, attempts = 0) {
  await db.insert(mediaGcOutbox).values({
    id,
    storageKey,
    attempts,
    nextAttemptAt,
    lastError: null,
    createdAt: 0,
  });
}

beforeEach(async () => {
  await db.delete(mediaGcOutbox);
});

describe("drainMediaGc", () => {
  it("removes a row once its bytes are deleted", async () => {
    await enqueue("g1", "key-a");
    const { storage, seen } = stubStorage();

    const result = await drainMediaGc({ db, storage, now: () => 1_000 });
    expect(result).toEqual({ claimed: 1, removed: 1, deferred: 0 });
    expect(seen).toEqual(["key-a"]);
    expect((await db.select().from(mediaGcOutbox)).length).toBe(0);
  });

  it("treats a not_found delete as settled and removes the row", async () => {
    await enqueue("g1", "key-gone");
    const { storage } = stubStorage({ "key-gone": { ok: false, error: "not_found" } });

    const result = await drainMediaGc({ db, storage, now: () => 1_000 });
    expect(result).toEqual({ claimed: 1, removed: 1, deferred: 0 });
    expect((await db.select().from(mediaGcOutbox)).length).toBe(0);
  });

  it("defers an unavailable delete on exponential backoff with the recorded error", async () => {
    await enqueue("g1", "key-down");
    const { storage } = stubStorage({ "key-down": { ok: false, error: "unavailable" } });

    const result = await drainMediaGc({ db, storage, now: () => 1_000 });
    expect(result).toEqual({ claimed: 1, removed: 0, deferred: 1 });

    const [row] = await db.select().from(mediaGcOutbox).where(eq(mediaGcOutbox.id, "g1"));
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe("unavailable");
    // First retry: base 60s delay off the pinned clock.
    expect(row?.nextAttemptAt).toBe(1_000 + 60_000);

    // A second sweep at the same instant does not touch a not-yet-due row.
    const again = await drainMediaGc({ db, storage, now: () => 1_000 });
    expect(again.claimed).toBe(0);
    // Later attempts back off further (60s * 2^attempts).
    const later = await drainMediaGc({ db, storage, now: () => 10_000_000 });
    expect(later.deferred).toBe(1);
    const [row2] = await db.select().from(mediaGcOutbox).where(eq(mediaGcOutbox.id, "g1"));
    expect(row2?.attempts).toBe(2);
    expect(row2?.nextAttemptAt).toBe(10_000_000 + 120_000);
  });

  it("defers a thrown storage error without losing the row", async () => {
    await enqueue("g1", "key-throw");
    const storage: Pick<MediaStorage, "delete"> = {
      async delete() {
        throw new Error("boom");
      },
    };
    const result = await drainMediaGc({ db, storage, now: () => 5_000 });
    expect(result).toEqual({ claimed: 1, removed: 0, deferred: 1 });
    const [row] = await db.select().from(mediaGcOutbox).where(eq(mediaGcOutbox.id, "g1"));
    expect(row?.attempts).toBe(1);
    expect(row?.lastError).toBe("boom");
  });

  it("only claims due rows, oldest first, up to the batch cap", async () => {
    await enqueue("due-1", "key-1", 100);
    await enqueue("due-2", "key-2", 50);
    await enqueue("future", "key-3", 9_999);
    const { storage, seen } = stubStorage();

    const result = await drainMediaGc({ db, storage, now: () => 1_000, batchSize: 10 });
    expect(result).toEqual({ claimed: 2, removed: 2, deferred: 0 });
    // Ordered by next_attempt_at ascending.
    expect(seen).toEqual(["key-2", "key-1"]);
    const remaining = await db.select().from(mediaGcOutbox).orderBy(asc(mediaGcOutbox.id));
    expect(remaining.map((r) => r.id)).toEqual(["future"]);
  });
});
