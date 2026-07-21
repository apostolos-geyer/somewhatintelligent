/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import {
  appContext,
  backendKeyFor,
  bytes,
  makeMeta,
  makeRoadie,
  sha256Hex,
  upload,
} from "./helpers";

// Signed-header enforcement is not exercised here — miniflare does not
// actually validate SigV4 signatures. The single-part lifecycle is covered
// by injecting bytes via the R2 binding (which models the successful result
// of a correct browser PUT) and then calling finalize.
describe("single-part upload lifecycle", () => {
  test("register → write bytes → finalize → blob becomes ready", async () => {
    const roadie = makeRoadie();
    const payload = bytes("hello-world");
    const hash = await sha256Hex(payload);

    const reg = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext(),
      },
      makeMeta(),
    );
    expect(reg.ok).toBe(true);
    if (!reg.ok || reg.value.status !== "single-part") return;
    const { referenceId } = reg.value;
    const backendKey = await backendKeyFor(roadie, referenceId);

    await roadie.env.BLOBS.put(backendKey, payload);

    const fin = await upload.finalize(roadie, { referenceId }, makeMeta());
    expect(fin.ok).toBe(true);
    if (!fin.ok) return;
    expect(fin.value.size).toBe(payload.length);
    expect(fin.value.hash).toBe(hash);
  });

  test("finalize with wrong backend size → size_mismatch, blob stays pending", async () => {
    const roadie = makeRoadie();
    const payload = bytes("expected-size-is-this");
    const hash = await sha256Hex(payload);

    const reg = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext(),
      },
      makeMeta(),
    );
    if (!reg.ok || reg.value.status !== "single-part") throw new Error("setup");
    const { referenceId } = reg.value;
    const backendKey = await backendKeyFor(roadie, referenceId);

    // Write bytes whose length differs from the declaration.
    await roadie.env.BLOBS.put(backendKey, bytes("shorter"));

    const fin = await upload.finalize(roadie, { referenceId }, makeMeta());
    expect(fin.ok).toBe(false);
    if (fin.ok) return;
    expect(fin.error).toBe("size_mismatch");

    // Retry is permitted — the blob remains pending. Writing correct bytes
    // and calling finalize again should still work.
    await roadie.env.BLOBS.put(backendKey, payload);
    const retry = await upload.finalize(roadie, { referenceId }, makeMeta());
    expect(retry.ok).toBe(true);
  });

  test("invalid hash is rejected", async () => {
    const roadie = makeRoadie();
    const r = await upload.registerUpload(
      roadie,
      {
        hash: "not-a-valid-hash",
        size: 10,
        contentType: "text/plain",
        application: appContext(),
      },
      makeMeta(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("invalid_hash");
  });

  test("size exceeding multipart max is rejected", async () => {
    const roadie = makeRoadie();
    const r = await upload.registerUpload(
      roadie,
      {
        hash: "a".repeat(64),
        size: 20 * 1024 * 1024 * 1024,
        contentType: "text/plain",
        application: appContext(),
      },
      makeMeta(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("size_exceeds_limit");
  });
});

describe("server-side put", () => {
  test("streams bytes through the R2 binding, creates a ready blob, caller holds the reference", async () => {
    const roadie = makeRoadie();
    const payload = bytes("server-side-bytes");
    const hash = await sha256Hex(payload);

    const r = await upload.put(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext(),
        body: payload.buffer as ArrayBuffer,
      },
      makeMeta(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.deduped).toBe(false);

    // Second put with same (owner, hash) should dedup without writing.
    const r2 = await upload.put(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "different" }),
        body: payload.buffer as ArrayBuffer,
      },
      makeMeta(),
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.value.deduped).toBe(true);
    expect(r2.value.blobId).toBe(r.value.blobId);
    expect(r2.value.referenceId).not.toBe(r.value.referenceId);
  });

  test("accepts a length-less stream body (RPC-tunneled streams lose length metadata)", async () => {
    const roadie = makeRoadie();
    const payload = bytes("stream-without-length");
    const hash = await sha256Hex(payload);
    // An identity TransformStream strips the known length, mirroring what a
    // body looks like after crossing a service-binding RPC hop.
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    void writer.write(payload).then(() => writer.close());

    const r = await upload.put(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext(),
        body: readable,
      },
      makeMeta(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = await roadie.env.BLOBS.get(r.value.blobId);
    expect(stored).not.toBeNull();
    expect(new Uint8Array((await stored!.arrayBuffer()) as ArrayBuffer)).toEqual(payload);
  });
});

describe("abandon", () => {
  test("abandon a pending upload drops the reference; already_ready for ready blobs", async () => {
    const roadie = makeRoadie();
    const payload = bytes("abandon-me");
    const hash = await sha256Hex(payload);

    const reg = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext(),
      },
      makeMeta(),
    );
    if (!reg.ok || reg.value.status !== "single-part") throw new Error("setup");
    const refA = reg.value.referenceId;

    const abandoned = await upload.abandon(roadie, { referenceId: refA }, makeMeta());
    expect(abandoned.ok).toBe(true);

    // Second abandon on same reference — reference no longer exists.
    const twice = await upload.abandon(roadie, { referenceId: refA }, makeMeta());
    expect(twice.ok).toBe(false);
    if (twice.ok) return;
    expect(twice.error).toBe("reference_not_found");

    // Create and finalize a blob, then try to abandon → already_ready.
    const reg2 = await upload.registerUpload(
      roadie,
      {
        hash: await sha256Hex(bytes("another")),
        size: 7,
        contentType: "text/plain",
        application: appContext(),
      },
      makeMeta(),
    );
    if (!reg2.ok || reg2.value.status !== "single-part") throw new Error("setup");
    const backendKey2 = await backendKeyFor(roadie, reg2.value.referenceId);
    await roadie.env.BLOBS.put(backendKey2, bytes("another"));
    await upload.finalize(roadie, { referenceId: reg2.value.referenceId }, makeMeta());

    const tooLate = await upload.abandon(
      roadie,
      { referenceId: reg2.value.referenceId },
      makeMeta(),
    );
    expect(tooLate.ok).toBe(false);
    if (tooLate.ok) return;
    expect(tooLate.error).toBe("already_ready");
  });
});
