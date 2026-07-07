/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import {
  read,
  upload,
  appContext,
  backendKeyFor,
  bytes,
  drainCtx,
  makeMeta,
  makeRoadie,
  sha256Hex,
} from "./helpers";

describe("getReadUrl", () => {
  async function setupReady(roadie: ReturnType<typeof makeRoadie>) {
    const payload = bytes("read-url-bytes-" + Math.random());
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
    const backendKey = await backendKeyFor(roadie, reg.value.referenceId);
    await roadie.env.BLOBS.put(backendKey, payload);
    await upload.finalize(roadie, { referenceId: reg.value.referenceId }, makeMeta());
    return reg.value.referenceId;
  }

  test("returns a URL; second call with same scope is a cache hit", async () => {
    const roadie = makeRoadie();
    const referenceId = await setupReady(roadie);

    const first = await read.getReadUrl(
      roadie,
      { referenceId, permissionScope: "owner:u_1" },
      makeMeta(),
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.cached).toBe(false);
    expect(typeof first.value.url).toBe("string");
    await drainCtx(roadie);

    const second = await read.getReadUrl(
      roadie,
      { referenceId, permissionScope: "owner:u_1" },
      makeMeta(),
    );
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.cached).toBe(true);
    expect(second.value.url).toBe(first.value.url);
  });

  test("different permission scope gets a fresh URL", async () => {
    const roadie = makeRoadie();
    const referenceId = await setupReady(roadie);

    const a = await read.getReadUrl(
      roadie,
      { referenceId, permissionScope: "owner:u_1" },
      makeMeta(),
    );
    await drainCtx(roadie);
    const b = await read.getReadUrl(
      roadie,
      { referenceId, permissionScope: "link:lnk_abc" },
      makeMeta(),
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.value.cached).toBe(false);
  });

  test("invalid lifetime → invalid_lifetime", async () => {
    const roadie = makeRoadie();
    const referenceId = await setupReady(roadie);

    const tooShort = await read.getReadUrl(
      roadie,
      { referenceId, permissionScope: "owner:u", lifetimeSeconds: 10 },
      makeMeta(),
    );
    expect(tooShort.ok).toBe(false);
    if (tooShort.ok) return;
    expect(tooShort.error).toBe("invalid_lifetime");

    const tooLong = await read.getReadUrl(
      roadie,
      {
        referenceId,
        permissionScope: "owner:u",
        lifetimeSeconds: 48 * 60 * 60,
      },
      makeMeta(),
    );
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) return;
    expect(tooLong.error).toBe("invalid_lifetime");
  });

  test("cross-caller referenceId returns reference_not_found", async () => {
    const chat = makeRoadie("chat");
    const referenceId = await setupReady(chat);

    const quiz = makeRoadie("quiz");
    const r = await read.getReadUrl(quiz, { referenceId, permissionScope: "anything" }, makeMeta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("reference_not_found");
  });

  test("reading a non-ready blob returns not_ready", async () => {
    const roadie = makeRoadie();
    const payload = bytes("not-yet-uploaded");
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

    const r = await read.getReadUrl(
      roadie,
      { referenceId: reg.value.referenceId, permissionScope: "x" },
      makeMeta(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("not_ready");
  });
});

describe("getReference", () => {
  test("returns metadata for a caller's reference", async () => {
    const roadie = makeRoadie("chat");
    const payload = bytes("meta-lookup");
    const hash = await sha256Hex(payload);
    const reg = await upload.registerUpload(
      roadie,
      {
        hash,
        size: payload.length,
        contentType: "application/octet-stream",
        application: appContext({ app: "chat", resourceType: "track", resourceId: "t_1" }),
      },
      makeMeta(),
    );
    if (!reg.ok || reg.value.status !== "single-part") throw new Error("setup");
    const backendKey2 = await backendKeyFor(roadie, reg.value.referenceId);
    await roadie.env.BLOBS.put(backendKey2, payload);
    await upload.finalize(roadie, { referenceId: reg.value.referenceId }, makeMeta());

    const r = await read.getReference(roadie, { referenceId: reg.value.referenceId }, makeMeta());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.state).toBe("ready");
    expect(r.value.hash).toBe(hash);
    expect(r.value.contentType).toBe("application/octet-stream");
    expect(r.value.application.app).toBe("chat");
  });

  test("cross-caller referenceId → reference_not_found", async () => {
    const chat = makeRoadie("chat");
    const payload = bytes("for-chat");
    const hash = await sha256Hex(payload);
    const reg = await upload.registerUpload(
      chat,
      {
        hash,
        size: payload.length,
        contentType: "text/plain",
        application: appContext(),
      },
      makeMeta(),
    );
    if (!reg.ok || reg.value.status !== "single-part") throw new Error("setup");

    const quiz = makeRoadie("quiz");
    const r = await read.getReference(quiz, { referenceId: reg.value.referenceId }, makeMeta());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("reference_not_found");
  });
});
