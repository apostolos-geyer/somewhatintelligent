/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import {
  appContext,
  backendKeyFor,
  bytes,
  makeMeta,
  makeRoadie,
  read,
  sha256Hex,
  upload,
} from "./helpers";

// Content-addressable dedup is the registration contract — consumers may rely
// on it (spec §Capabilities — Registration). After the owner-drop refactor
// dedup is global on hash: two consumers uploading the same bytes share one
// physical blob regardless of identity.
describe("content-addressable dedup (global on hash)", () => {
  test("second register at same hash returns existing blob with a new reference", async () => {
    const roadie = makeRoadie();
    const payload = bytes("dedup-test-bytes-A");
    const hash = await sha256Hex(payload);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_a" }),
      },
      makeMeta(),
    );
    expect(first.ok).toBe(true);
    if (!first.ok || first.value.status !== "single-part") return;
    const firstBlobId = first.value.blobId;

    const backendKey = await backendKeyFor(roadie, first.value.referenceId);
    await roadie.env.BLOBS.put(backendKey, payload);
    const finalized = await upload.finalize(
      roadie,
      { referenceId: first.value.referenceId },
      makeMeta(),
    );
    expect(finalized.ok).toBe(true);

    // Second register for the same hash in a different resource → dedup hit.
    const second = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_b" }),
      },
      makeMeta(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.status).toBe("ready");
    if (second.value.status !== "ready") return;
    expect(second.value.blobId).toBe(firstBlobId);
    expect(second.value.referenceId).not.toBe(first.value.referenceId);
  });

  test("global dedup ignores caller identity — a different caller hits the same blob", async () => {
    const chat = makeRoadie("chat");
    const quiz = makeRoadie("quiz");
    const payload = bytes("dedup-test-bytes-B");
    const hash = await sha256Hex(payload);

    const a = await upload.registerUpload(
      chat,
      { hash, size: payload.length, contentType: "text/plain", application: appContext() },
      makeMeta(),
    );
    expect(a.ok).toBe(true);
    if (!a.ok || a.value.status !== "single-part") return;
    const backendKey = await backendKeyFor(chat, a.value.referenceId);
    await chat.env.BLOBS.put(backendKey, payload);
    await upload.finalize(chat, { referenceId: a.value.referenceId }, makeMeta());

    const b = await upload.registerUpload(
      quiz,
      { hash, size: payload.length, contentType: "text/plain", application: appContext() },
      makeMeta(),
    );
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(b.value.status).toBe("ready");
    if (b.value.status !== "ready") return;
    expect(b.value.blobId).toBe(a.value.blobId);
  });
});

// Retry behaviour for uploads that never finalized. A prior registerUpload
// created a physical_blob row but the bytes never landed in R2. The retry
// contract is: same caller tuple → idempotent (same referenceId, fresh
// envelope); different tuple → take over (same blob, NEW referenceId,
// previous reference invalidated).
describe("pending state (bytes not yet in R2)", () => {
  test("same-tuple retry is idempotent — same referenceId, fresh envelope", async () => {
    const roadie = makeRoadie();
    const payload = bytes("pending-retry-bytes-A");
    const hash = await sha256Hex(payload);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_a" }),
      },
      makeMeta(),
    );
    if (!first.ok || first.value.status !== "single-part") throw new Error("expected single-part");

    const second = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_a" }),
      },
      makeMeta(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok || second.value.status !== "single-part") return;
    expect(second.value.blobId).toBe(first.value.blobId);
    expect(second.value.referenceId).toBe(first.value.referenceId);
  });

  test("different-tuple retry TAKES OVER the reference on the pending blob", async () => {
    // Preserves "one reference per pending blob" by reassigning, not
    // duplicating. The previous reference handle is invalidated.
    const roadie = makeRoadie();
    const payload = bytes("takeover-bytes");
    const hash = await sha256Hex(payload);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_first" }),
      },
      makeMeta(),
    );
    if (!first.ok || first.value.status !== "single-part") throw new Error("expected single-part");

    const second = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_second" }),
      },
      makeMeta(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok || second.value.status !== "single-part") return;

    expect(second.value.blobId).toBe(first.value.blobId);
    expect(second.value.referenceId).not.toBe(first.value.referenceId);

    // First caller's reference handle is invalidated.
    const abandonFirst = await upload.abandon(
      roadie,
      { referenceId: first.value.referenceId },
      makeMeta(),
    );
    expect(abandonFirst.ok).toBe(false);
    if (abandonFirst.ok) return;
    expect(abandonFirst.error).toBe("reference_not_found");
  });

  test("after retry PUT + finalize, subsequent register returns 'ready'", async () => {
    const roadie = makeRoadie();
    const payload = bytes("pending-retry-bytes-C");
    const hash = await sha256Hex(payload);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_c" }),
      },
      makeMeta(),
    );
    if (!first.ok || first.value.status !== "single-part") throw new Error("expected single-part");

    const retry = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_c" }),
      },
      makeMeta(),
    );
    if (!retry.ok || retry.value.status !== "single-part") throw new Error("expected single-part");

    const backendKey = await backendKeyFor(roadie, retry.value.referenceId);
    await roadie.env.BLOBS.put(backendKey, payload);
    const finalized = await upload.finalize(
      roadie,
      { referenceId: retry.value.referenceId },
      makeMeta(),
    );
    expect(finalized.ok).toBe(true);

    const third = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "res_c_another" }),
      },
      makeMeta(),
    );
    expect(third.ok).toBe(true);
    if (!third.ok) return;
    expect(third.value.status).toBe("ready");
    if (third.value.status !== "ready") return;
    expect(third.value.blobId).toBe(first.value.blobId);
  });

  test("take-over recovers a pending blob whose originator abandoned it", async () => {
    // Originator registers, changes their mind, abandons. Before the refactor
    // this left the pending row blocking the hash until the reaper fired
    // (which didn't ship in v1). With take-over semantics, the next caller
    // just starts a fresh upload: the partial UNIQUE index on hash is scoped
    // WHERE deleted_at IS NULL, so the abandoned row (which is deleted) no
    // longer blocks.
    const roadie = makeRoadie();
    const payload = bytes("abandon-then-takeover");
    const hash = await sha256Hex(payload);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "abandoned" }),
      },
      makeMeta(),
    );
    if (!first.ok || first.value.status !== "single-part") throw new Error("setup");

    // Originator abandons before uploading.
    const abandoned = await upload.abandon(
      roadie,
      { referenceId: first.value.referenceId },
      makeMeta(),
    );
    expect(abandoned.ok).toBe(true);

    // A different caller now registers the same hash. With the abandoned row
    // soft-deleted (and therefore outside the partial UNIQUE index), this
    // must create a fresh physical blob, not fail on the unique constraint.
    const second = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext({ resourceId: "recovering" }),
      },
      makeMeta(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok || second.value.status !== "single-part") return;
    expect(second.value.blobId).not.toBe(first.value.blobId);
  });

  // Skipped under miniflare: `createMultipartUpload` makes a real HTTPS call
  // to `r2.cloudflarestorage.com` (R2's S3 API isn't routed through the
  // binding), so this lifecycle is only exercisable against real R2. Same
  // documented-gap pattern as presigned-URL round-trips.
  test.skip("multipart take-over preserves the R2 upload id and part records", async () => {
    // Multipart case: originator kicks off a multipart upload and records
    // some parts. A second caller with a different tuple hits the same hash
    // before finalize — take-over reassigns the reference but must preserve
    // the physical row's r2_upload_id, partSize, partCount (so the new
    // caller can resume rather than start from scratch).
    const roadie = makeRoadie();
    // Synthesize a size > SINGLE_PART_LIMIT_BYTES (100 MB) to force multipart.
    const multipartSize = 101 * 1024 * 1024;
    const hash = "a".repeat(64);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: multipartSize,
        contentType: "application/octet-stream",
        application: appContext({ resourceId: "mp_first" }),
      },
      makeMeta(),
    );
    if (!first.ok || first.value.status !== "multipart") throw new Error("setup");
    const originalUploadId = first.value.uploadId;
    const originalPartSize = first.value.partSize;
    const originalPartCount = first.value.partCount;

    const second = await upload.registerUpload(
      roadie,
      {
        hash,
        size: multipartSize,
        contentType: "application/octet-stream",
        application: appContext({ resourceId: "mp_second" }),
      },
      makeMeta(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok || second.value.status !== "multipart") return;

    // Same blob, same R2 upload id, same part geometry. New referenceId.
    expect(second.value.blobId).toBe(first.value.blobId);
    expect(second.value.uploadId).toBe(originalUploadId);
    expect(second.value.partSize).toBe(originalPartSize);
    expect(second.value.partCount).toBe(originalPartCount);
    expect(second.value.referenceId).not.toBe(first.value.referenceId);
  });

  test("two references to same bytes carry independent content-types", async () => {
    // Content-type moved to the reference because two callers can legitimately
    // label identical bytes differently (e.g. one says "image/jpeg", another
    // says "application/octet-stream" because it's forwarding raw). The
    // dedup path must preserve each caller's own label on their reference.
    const roadie = makeRoadie();
    const payload = bytes("typed-bytes-A");
    const hash = await sha256Hex(payload);

    const first = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "image/jpeg",
        application: appContext({ resourceId: "labeled_jpeg" }),
      },
      makeMeta(),
    );
    if (!first.ok || first.value.status !== "single-part") throw new Error("setup");
    const backendKey = await backendKeyFor(roadie, first.value.referenceId);
    await roadie.env.BLOBS.put(backendKey, payload);
    await upload.finalize(roadie, { referenceId: first.value.referenceId }, makeMeta());

    const second = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "application/octet-stream",
        application: appContext({ resourceId: "labeled_raw" }),
      },
      makeMeta(),
    );
    if (!second.ok || second.value.status !== "ready") throw new Error("expected dedup hit");

    // Query each reference back and confirm the labels didn't merge.
    const metaFirst = await read.getReference(
      roadie,
      { referenceId: first.value.referenceId },
      makeMeta(),
    );
    const metaSecond = await read.getReference(
      roadie,
      { referenceId: second.value.referenceId },
      makeMeta(),
    );
    expect(metaFirst.ok && metaSecond.ok).toBe(true);
    if (!metaFirst.ok || !metaSecond.ok) return;
    expect(metaFirst.value.contentType).toBe("image/jpeg");
    expect(metaSecond.value.contentType).toBe("application/octet-stream");
    expect(metaFirst.value.blobId).toBe(metaSecond.value.blobId);
  });
});
