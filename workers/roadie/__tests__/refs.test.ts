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

// Reference lifecycle tests exercise spec §Capabilities — Reference
// management and the immediate ARC-at-zero behavior that replaces the
// zero-ref reaper in v1.
describe("reference lifecycle", () => {
  async function setupReadyBlob(roadie: ReturnType<typeof makeRoadie>) {
    const payload = bytes("ref-lifecycle-" + Math.random());
    const hash = await sha256Hex(payload);
    const reg = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "original" }),
      },
      makeMeta(),
    );
    if (!reg.ok || reg.value.status !== "single-part") throw new Error("setup");
    const backendKey = await backendKeyFor(roadie, reg.value.referenceId);
    await roadie.env.BLOBS.put(backendKey, payload);
    await upload.finalize(roadie, { referenceId: reg.value.referenceId }, makeMeta());
    return { blobId: reg.value.blobId, referenceId: reg.value.referenceId };
  }

  test("addReference increments refcount; removeReference decrements", async () => {
    const roadie = makeRoadie("chat");
    const { blobId, referenceId } = await setupReadyBlob(roadie);

    const db = createDb(roadie.env.DB);
    const [before] = await db
      .select({ refcount: blobTable.refcount })
      .from(blobTable)
      .where(eq(blobTable.id, blobId));
    expect(before?.refcount).toBe(1);

    const added = await refs.addReference(
      roadie,
      { sourceReferenceId: referenceId, application: appContext({ resourceId: "shared" }) },
      makeMeta(),
    );
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    const [after] = await db
      .select({ refcount: blobTable.refcount })
      .from(blobTable)
      .where(eq(blobTable.id, blobId));
    expect(after?.refcount).toBe(2);

    const removed = await refs.removeReference(
      roadie,
      { referenceId: added.value.referenceId },
      makeMeta(),
    );
    expect(removed.ok).toBe(true);

    const [afterRemove] = await db
      .select({ refcount: blobTable.refcount })
      .from(blobTable)
      .where(eq(blobTable.id, blobId));
    expect(afterRemove?.refcount).toBe(1);
  });

  test("removeReference is caller-scoped — a different caller's reference is treated as not-existing", async () => {
    const roadieA = makeRoadie("chat");
    const { referenceId } = await setupReadyBlob(roadieA);

    // A different consumer tries to remove the reference — no-op success.
    const roadieB = makeRoadie("quiz");
    const removed = await refs.removeReference(roadieB, { referenceId }, makeMeta());
    expect(removed.ok).toBe(true);

    // The original reference is still intact.
    const db = createDb(roadieA.env.DB);
    const [rows] = await db
      .select()
      .from(blobTable)
      .where(eq(blobTable.id, (await db.select().from(blobTable))[0]?.id ?? ""));
    expect(rows).toBeDefined();
  });

  test("addReference refuses a source referenceId belonging to a different caller", async () => {
    const roadieA = makeRoadie("chat");
    const { referenceId } = await setupReadyBlob(roadieA);

    const roadieB = makeRoadie("quiz");
    const r = await refs.addReference(
      roadieB,
      { sourceReferenceId: referenceId, application: appContext({ app: "quiz" }) },
      makeMeta(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("reference_not_found");
  });

  test("removing the last reference brings refcount to zero and marks the blob deleted", async () => {
    const roadie = makeRoadie("chat");
    const { blobId, referenceId } = await setupReadyBlob(roadie);

    const removed = await refs.removeReference(roadie, { referenceId }, makeMeta());
    expect(removed.ok).toBe(true);
    await drainCtx(roadie);

    const db = createDb(roadie.env.DB);
    const [after] = await db
      .select({ refcount: blobTable.refcount, deletedAt: blobTable.deletedAt })
      .from(blobTable)
      .where(eq(blobTable.id, blobId));
    expect(after?.refcount).toBe(0);
    expect(after?.deletedAt).not.toBeNull();
  });
});
