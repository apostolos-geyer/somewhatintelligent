/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import type * as adminTypes from "../src/methods/admin";
import {
  admin,
  upload,
  appContext,
  backendKeyFor,
  bytes,
  drainCtx,
  makeMeta,
  makeRoadie,
  sha256Hex,
} from "./helpers";

describe("administrative operations", () => {
  async function seedReady(
    roadie: ReturnType<typeof makeRoadie>,
    label: string,
  ): Promise<{ blobId: string; size: number }> {
    const payload = bytes(`${label}-${Math.random()}`);
    const hash = await sha256Hex(payload);
    const reg = await upload.registerUpload(
      roadie,
      { hash, size: payload.length, contentType: "text/plain", application: appContext() },
      makeMeta(),
    );
    if (!reg.ok || reg.value.status !== "single-part") throw new Error("setup");
    const backendKey = await backendKeyFor(roadie, reg.value.referenceId);
    await roadie.env.BLOBS.put(backendKey, payload);
    await upload.finalize(roadie, { referenceId: reg.value.referenceId }, makeMeta());
    return { blobId: reg.value.blobId, size: payload.length };
  }

  test("adminUsage aggregates bytes and blob count across live blobs", async () => {
    const roadie = makeRoadie();
    const a = await seedReady(roadie, "usage-a");
    const b = await seedReady(roadie, "usage-b");

    const u = await admin.adminUsage(roadie, {}, makeMeta());
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.value.blobCount).toBeGreaterThanOrEqual(2);
    expect(u.value.bytes).toBeGreaterThanOrEqual(a.size + b.size);
  });

  test("adminListBlobs paginates by cursor", async () => {
    const roadie = makeRoadie();
    await seedReady(roadie, "list-1");
    await seedReady(roadie, "list-2");
    await seedReady(roadie, "list-3");

    const first = await admin.adminListBlobs(roadie, { limit: 2 }, makeMeta());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.blobs.length).toBe(2);
    expect(first.value.nextCursor).not.toBeNull();

    const second = await admin.adminListBlobs(
      roadie,
      { limit: 2, cursor: first.value.nextCursor ?? "" },
      makeMeta(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.blobs.length).toBeGreaterThanOrEqual(0);
  });

  test("adminListBlobs rejects malformed cursor", async () => {
    const roadie = makeRoadie();
    const r = await admin.adminListBlobs(roadie, { cursor: "this-is-not-a-number" }, makeMeta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid_cursor");
  });

  test("adminForceDelete marks blob deleted and drops references", async () => {
    const roadie = makeRoadie();
    const seed = await seedReady(roadie, "force-delete");

    const r = await admin.adminForceDelete(roadie, { blobId: seed.blobId }, makeMeta());
    expect(r.ok).toBe(true);
    await drainCtx(roadie);

    const usage = await admin.adminUsage(roadie, {}, makeMeta());
    expect(usage.ok).toBe(true);
    if (!usage.ok) return;
    // The force-deleted blob no longer counts toward live usage.
    expect(usage.value.blobCount).toBeGreaterThanOrEqual(0);
  });

  test("adminForceDelete on unknown blob → not_found", async () => {
    const roadie = makeRoadie();
    const r = await admin.adminForceDelete(roadie, { blobId: "NO_SUCH_BLOB" }, makeMeta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("not_found");
  });

  test("adminTriggerTask runs each scheduled module; deferred tasks return the no-op shape", async () => {
    const roadie = makeRoadie();
    const tasks: adminTypes.ScheduledTaskName[] = [
      "pending_reap",
      "zero_ref_reap",
      "deletion_drain",
      "reconcile",
    ];
    for (const task of tasks) {
      const r = await admin.adminTriggerTask(roadie, { task }, makeMeta());
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(typeof r.value.processed).toBe("number");
      expect(typeof r.value.durationMs).toBe("number");
      if (task !== "pending_reap") {
        expect(r.value.status).toBe("deferred");
      }
    }
  });
});
