/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { eq } from "drizzle-orm";
import { createDb } from "../src/db";
import { physicalBlob as blobTable } from "../src/schema";
import {
  refs,
  upload,
  appContext,
  backendKeyFor,
  bytes,
  drainCtx,
  makeMeta,
  makeRoadie,
  sha256Hex,
} from "./helpers";

// Same-blob concurrency tests exercising the refcount math and the
// ARC-at-zero guards. Each test drives interleavings by issuing multiple
// calls concurrently via Promise.all — D1 serializes their atomic SQL
// fragments — and the assertions pin down the expected outcome.

describe("refcount concurrency", () => {
  async function setupReadyBlob(
    roadie: ReturnType<typeof makeRoadie>,
    resourceId: string = "original",
  ) {
    const payload = bytes("concurrency-" + Math.random());
    const hash = await sha256Hex(payload);
    const reg = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId }),
      },
      makeMeta(),
    );
    if (!reg.ok || reg.value.status !== "single-part") throw new Error("setup");
    const backendKey = await backendKeyFor(roadie, reg.value.referenceId);
    await roadie.env.BLOBS.put(backendKey, payload);
    await upload.finalize(roadie, { referenceId: reg.value.referenceId }, makeMeta());
    return { blobId: reg.value.blobId, referenceId: reg.value.referenceId, hash, payload };
  }

  test("parallel dedup-hit registerUpload calls increment refcount atomically", async () => {
    // Start with a ready blob (refcount = 1), then issue N parallel dedup
    // registrations. Final refcount must be 1 + N — increments must be
    // atomic across concurrent registrations.
    const roadie = makeRoadie();
    const { blobId, hash, payload } = await setupReadyBlob(roadie);

    const PARALLEL = 8;
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        upload.registerUpload(
          roadie,
          {
            hash,
            size: payload.length,
            contentType: "text/plain",
            application: appContext({ resourceId: `dedup_${i}` }),
          },
          makeMeta(),
        ),
      ),
    );
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.status).toBe("ready");
    }

    const db = createDb(roadie.env.DB);
    const [row] = await db
      .select({ refcount: blobTable.refcount })
      .from(blobTable)
      .where(eq(blobTable.id, blobId));
    expect(row?.refcount).toBe(1 + PARALLEL);
  });

  test("parallel dedup-hit put calls increment refcount atomically", async () => {
    const roadie = makeRoadie();
    const payload = bytes("put-concurrency");
    const hash = await sha256Hex(payload);

    const first = await upload.put(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "first" }),
        body: payload.buffer as ArrayBuffer,
      },
      makeMeta(),
    );
    if (!first.ok) throw new Error("setup");

    const PARALLEL = 6;
    const results = await Promise.all(
      Array.from({ length: PARALLEL }, (_, i) =>
        upload.put(
          roadie,
          {
            hash,
            size: payload.length,
            contentType: "text/plain",
            application: appContext({ resourceId: `put_${i}` }),
            body: payload.buffer as ArrayBuffer,
          },
          makeMeta(),
        ),
      ),
    );
    for (const r of results) {
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.value.deduped).toBe(true);
    }

    const db = createDb(roadie.env.DB);
    const [row] = await db
      .select({ refcount: blobTable.refcount })
      .from(blobTable)
      .where(eq(blobTable.id, first.value.blobId));
    expect(row?.refcount).toBe(1 + PARALLEL);
  });

  test("addReference racing with removeReference preserves a live blob", async () => {
    // Starting refcount = 1. Add a reference (2), then race another add with
    // the remove of the original. Final refcount = 2 (both new refs live,
    // original gone). Blob must not be marked deleted.
    const roadie = makeRoadie();
    const { blobId, referenceId } = await setupReadyBlob(roadie);

    const seeded = await refs.addReference(
      roadie,
      { sourceReferenceId: referenceId, application: appContext({ resourceId: "seed" }) },
      makeMeta(),
    );
    if (!seeded.ok) throw new Error("setup");

    const [addRes, removeRes] = await Promise.all([
      refs.addReference(
        roadie,
        {
          sourceReferenceId: seeded.value.referenceId,
          application: appContext({ resourceId: "racing-add" }),
        },
        makeMeta(),
      ),
      refs.removeReference(roadie, { referenceId }, makeMeta()),
    ]);
    expect(addRes.ok).toBe(true);
    expect(removeRes.ok).toBe(true);

    const db = createDb(roadie.env.DB);
    const [row] = await db
      .select({ refcount: blobTable.refcount, deletedAt: blobTable.deletedAt })
      .from(blobTable)
      .where(eq(blobTable.id, blobId));
    expect(row?.refcount).toBe(2);
    expect(row?.deletedAt).toBeNull();
  });

  test("removeReference with concurrent addReference aborts GC on refcount bump", async () => {
    // Starting refcount = 1 (the original). Run a remove (which will
    // decrement to 0 and attempt GC) while an add races to bump to 1. At
    // worst either: (a) the remove wins and GC fires → the add sees
    // not_ready; or (b) the add wins first and the remove's GC aborts.
    // The invariant we assert: if BOTH succeeded, refcount must be > 0
    // and deletedAt must be null — bytes survive.
    const roadie = makeRoadie();
    const { blobId, referenceId } = await setupReadyBlob(roadie);

    const [addRes, removeRes] = await Promise.all([
      refs.addReference(
        roadie,
        { sourceReferenceId: referenceId, application: appContext({ resourceId: "survivor" }) },
        makeMeta(),
      ),
      refs.removeReference(roadie, { referenceId }, makeMeta()),
    ]);
    expect(removeRes.ok).toBe(true);
    await drainCtx(roadie);

    const db = createDb(roadie.env.DB);
    const [row] = await db
      .select({ refcount: blobTable.refcount, deletedAt: blobTable.deletedAt })
      .from(blobTable)
      .where(eq(blobTable.id, blobId));

    if (addRes.ok) {
      // Add saw the source reference before remove committed → its new
      // reference is live and the ARC-at-zero guard must have aborted.
      expect(row?.deletedAt).toBeNull();
      expect((row?.refcount ?? 0) > 0).toBe(true);
    } else {
      // Remove committed first, then add saw deleted source → not_ready.
      expect(addRes.error).toBe("not_ready");
      expect(row?.deletedAt).not.toBeNull();
    }
  });

  test("abandon racing with a take-over register on a pending blob", async () => {
    // Register a pending upload (refcount = 1). Concurrently abandon the
    // original reference and register a second one under a different tuple.
    // Possible outcomes depend on which write commits first:
    //   (a) abandon wins → physical blob is torn down; the take-over arrives
    //       to find no live blob and creates a fresh one.
    //   (b) take-over wins → reference reassigns to the new tuple (refcount
    //       stays 1); abandon then tries to delete a reference that no longer
    //       has its original id and returns reference_not_found.
    // Either outcome preserves the invariants: the blob never ends up with
    // refcount > 1 while pending, and its bytes are never orphaned.
    const roadie = makeRoadie();
    const payload = bytes("abandon-race");
    const hash = await sha256Hex(payload);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "first" }),
      },
      makeMeta(),
    );
    if (!first.ok || first.value.status !== "single-part") throw new Error("setup");

    const [secondRes, abandonRes] = await Promise.all([
      upload.registerUpload(
        roadie,
        {
          hash,
          size: payload.length,
          contentType: "text/plain",
          application: appContext({ resourceId: "second" }),
        },
        makeMeta(),
      ),
      upload.abandon(roadie, { referenceId: first.value.referenceId }, makeMeta()),
    ]);

    // Exactly one of the two calls must have succeeded against the original
    // physical blob; the other observed state the first had changed.
    const db = createDb(roadie.env.DB);
    const [row] = await db
      .select({ refcount: blobTable.refcount, deletedAt: blobTable.deletedAt })
      .from(blobTable)
      .where(eq(blobTable.id, first.value.blobId));

    if (abandonRes.ok && secondRes.ok && secondRes.value.blobId === first.value.blobId) {
      // Take-over beat abandon to the reference row → abandon found nothing;
      // second reassigned the existing reference and refcount stays at 1.
      expect(row?.refcount).toBe(1);
      expect(row?.deletedAt).toBeNull();
    } else {
      // Abandon won, OR second saw no live blob and created a fresh one.
      // Either way the first physical blob is torn down.
      expect(abandonRes.ok).toBe(true);
      expect(row?.refcount).toBe(0);
      expect(row?.deletedAt).not.toBeNull();
    }
  });
});
