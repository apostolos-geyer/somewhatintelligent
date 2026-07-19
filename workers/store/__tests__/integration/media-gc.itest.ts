/**
 * D1 integration (real local D1 via miniflare): the media-GC drain
 * (drainMediaGcOutbox, RFC-0001 D8/D10). The outbox is the async physical-byte
 * cleanup behind the two-step hard delete — success/not_found retires a row,
 * transient failure backs it off. The MediaStorage port is injected, so no
 * Roadie client is constructed here; only the D1 drain path is exercised.
 */
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { drainMediaGcOutbox } from "@/lib/media-gc";
import type { MediaStorage, StorageResult } from "@/lib/media-storage";
import { db } from "./helpers";

const { storeMediaGcOutbox } = schema;

const NOW = Date.UTC(2026, 6, 12, 12, 0, 0);

// A MediaStorage whose delete() is driven per test; put/read are unused by the
// drain and return unavailable. Records every key the drain asks to delete.
function stubStorage(deleteImpl: (key: string) => Promise<StorageResult<void>>): {
  storage: MediaStorage;
  keys: string[];
} {
  const keys: string[] = [];
  const storage: MediaStorage = {
    put: async () => ({ ok: false, error: "unavailable" }),
    read: async () => ({ ok: false, error: "unavailable" }),
    delete: async ({ key }) => {
      keys.push(key);
      return deleteImpl(key);
    },
  };
  return { storage, keys };
}

async function seedOutbox(opts: {
  id: string;
  storageKey: string;
  attempts?: number;
  nextAttemptAt: Date;
  lastError?: string | null;
}) {
  await db.insert(storeMediaGcOutbox).values({
    id: opts.id,
    storageKey: opts.storageKey,
    attempts: opts.attempts ?? 0,
    nextAttemptAt: opts.nextAttemptAt,
    lastError: opts.lastError ?? null,
    createdAt: new Date(opts.nextAttemptAt),
  });
}

const due = (offsetMs = -1000) => new Date(NOW + offsetMs);

beforeEach(async () => {
  await db.delete(storeMediaGcOutbox);
});

describe("drainMediaGcOutbox", () => {
  it("deletes the bytes and retires the outbox row on success", async () => {
    await seedOutbox({ id: "g1", storageKey: "k1", nextAttemptAt: due() });
    await seedOutbox({ id: "g2", storageKey: "k2", nextAttemptAt: due() });
    const { storage, keys } = stubStorage(async () => ({ ok: true, value: undefined }));

    const res = await drainMediaGcOutbox({ db, storage, now: NOW });
    expect(res).toEqual({ deleted: 2, retried: 0 });
    expect(keys.sort()).toEqual(["k1", "k2"]);
    expect(await db.select().from(storeMediaGcOutbox)).toHaveLength(0);
  });

  it("treats not_found as already-done and retires the row", async () => {
    await seedOutbox({ id: "g1", storageKey: "gone", nextAttemptAt: due() });
    const { storage } = stubStorage(async () => ({ ok: false, error: "not_found" }));

    const res = await drainMediaGcOutbox({ db, storage, now: NOW });
    expect(res).toEqual({ deleted: 1, retried: 0 });
    expect(await db.select().from(storeMediaGcOutbox)).toHaveLength(0);
  });

  it("backs off and records lastError on a transient (unavailable) failure", async () => {
    await seedOutbox({ id: "g1", storageKey: "k1", attempts: 0, nextAttemptAt: due() });
    const { storage } = stubStorage(async () => ({ ok: false, error: "unavailable" }));

    const res = await drainMediaGcOutbox({ db, storage, now: NOW });
    expect(res).toEqual({ deleted: 0, retried: 1 });
    const [row] = await db.select().from(storeMediaGcOutbox).where(eq(storeMediaGcOutbox.id, "g1"));
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toBe("unavailable");
    // First failure → 60s backoff from the drain clock.
    expect(row!.nextAttemptAt.getTime()).toBe(NOW + 60_000);
  });

  it("records a thrown port exception as lastError and retries", async () => {
    await seedOutbox({ id: "g1", storageKey: "k1", nextAttemptAt: due() });
    const { storage } = stubStorage(async () => {
      throw new Error("port blew up");
    });

    const res = await drainMediaGcOutbox({ db, storage, now: NOW });
    expect(res).toEqual({ deleted: 0, retried: 1 });
    const [row] = await db.select().from(storeMediaGcOutbox).where(eq(storeMediaGcOutbox.id, "g1"));
    expect(row!.attempts).toBe(1);
    expect(row!.lastError).toBe("port blew up");
  });

  it("grows the backoff exponentially with attempts (capped)", async () => {
    await seedOutbox({ id: "g1", storageKey: "k1", attempts: 3, nextAttemptAt: due() });
    const { storage } = stubStorage(async () => ({ ok: false, error: "unavailable" }));

    await drainMediaGcOutbox({ db, storage, now: NOW });
    const [row] = await db.select().from(storeMediaGcOutbox).where(eq(storeMediaGcOutbox.id, "g1"));
    expect(row!.attempts).toBe(4);
    // 60s * 2^(4-1) = 480s.
    expect(row!.nextAttemptAt.getTime()).toBe(NOW + 480_000);
  });

  it("skips rows whose nextAttemptAt is still in the future", async () => {
    await seedOutbox({ id: "future", storageKey: "kf", nextAttemptAt: new Date(NOW + 60_000) });
    await seedOutbox({ id: "due", storageKey: "kd", nextAttemptAt: due() });
    const { storage, keys } = stubStorage(async () => ({ ok: true, value: undefined }));

    const res = await drainMediaGcOutbox({ db, storage, now: NOW });
    expect(res).toEqual({ deleted: 1, retried: 0 });
    expect(keys).toEqual(["kd"]);
    expect(
      await db.select().from(storeMediaGcOutbox).where(eq(storeMediaGcOutbox.id, "future")),
    ).toHaveLength(1);
  });

  it("caps the per-run batch to the limit and leaves the rest for the next tick", async () => {
    await seedOutbox({ id: "a", storageKey: "ka", nextAttemptAt: due(-3000) });
    await seedOutbox({ id: "b", storageKey: "kb", nextAttemptAt: due(-2000) });
    await seedOutbox({ id: "c", storageKey: "kc", nextAttemptAt: due(-1000) });
    const { storage } = stubStorage(async () => ({ ok: true, value: undefined }));

    const res = await drainMediaGcOutbox({ db, storage, now: NOW, limit: 2 });
    expect(res.deleted).toBe(2);
    // Oldest-due-first ordering: c (most recent) is the leftover.
    const rest = await db.select().from(storeMediaGcOutbox);
    expect(rest.map((r) => r.id)).toEqual(["c"]);
  });
});
