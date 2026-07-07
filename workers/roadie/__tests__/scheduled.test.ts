/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { eq } from "drizzle-orm";
import { createDb } from "../src/db";
import { physicalBlob } from "../src/schema";
import {
  appContext,
  bytes,
  drainCtx,
  makeMeta,
  makeRoadie,
  pendingReap,
  sha256Hex,
  upload,
} from "./helpers";

describe("pending reaper", () => {
  test("reaps pending blobs older than the timer and drops their reference rows", async () => {
    const roadie = makeRoadie();
    const payload = bytes("pending-bytes");
    const hash = await sha256Hex(payload);

    const reg = await upload.registerUpload(
      roadie,
      { hash, size: payload.length, contentType: "text/plain", application: appContext() },
      makeMeta(),
    );
    expect(reg.ok).toBe(true);
    if (!reg.ok || reg.value.status !== "single-part") return;

    // Backdate the physical blob's creation time to force it past the pending
    // timer window. (timestamp_ms columns store ms; 48h ago is well past 24h.)
    const db = createDb(roadie.env.DB);
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await db
      .update(physicalBlob)
      .set({ createdAt: longAgo })
      .where(eq(physicalBlob.id, reg.value.blobId));

    const result = await pendingReap.run(roadie.env, roadie.ctx);
    expect(result.processed).toBeGreaterThanOrEqual(1);
    await drainCtx(roadie);

    const [row] = await db
      .select({ deletedAt: physicalBlob.deletedAt })
      .from(physicalBlob)
      .where(eq(physicalBlob.id, reg.value.blobId));
    expect(row?.deletedAt).not.toBeNull();
  });

  test("leaves fresh pending blobs alone", async () => {
    const roadie = makeRoadie();
    const payload = bytes("fresh-pending");
    const hash = await sha256Hex(payload);
    const reg = await upload.registerUpload(
      roadie,
      { hash, size: payload.length, contentType: "text/plain", application: appContext() },
      makeMeta(),
    );
    expect(reg.ok).toBe(true);
    if (!reg.ok || reg.value.status !== "single-part") return;

    const before = await pendingReap.run(roadie.env, roadie.ctx);
    await drainCtx(roadie);

    const db = createDb(roadie.env.DB);
    const [row] = await db
      .select({ deletedAt: physicalBlob.deletedAt })
      .from(physicalBlob)
      .where(eq(physicalBlob.id, reg.value.blobId));
    expect(row?.deletedAt).toBeNull();
    expect(before.processed).toBeGreaterThanOrEqual(0);
  });
});
