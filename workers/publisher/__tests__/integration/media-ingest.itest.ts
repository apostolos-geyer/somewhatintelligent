/**
 * D1 integration: the private `PublisherOperatorWrites.ingestMedia` surface
 * (T19 / RFC-0001 D10) against a REAL local D1 with an injected `MediaStorage`
 * stub. Proves the happy path writes a ready `publisher_media` row and returns
 * the completed `PublisherMediaDTO`; that the private `storage_key` never
 * appears in the DTO (INV-MEDIA-1); owner resolution (text/software by id, page
 * by PageKey → internal id); and the content-type / size / role validation
 * rules mirrored from Store's ingest. No `operator_event` is written — the
 * storage lifecycle is not an audited mutation.
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";

import * as schema from "@/schema";
import type { OperatorCall } from "@si/contracts";
import { PublisherOperatorWrites } from "@/operator/writes";
import type { MediaStorage } from "@/lib/media-storage";
import { DEFAULT_PAGE_DOCUMENTS } from "@/lib/default-page-documents";

const db = drizzle(env.DB, { schema });

const {
  textEntry,
  softwareEntry,
  publisherMedia,
  pageEntry,
  operatorEvent,
  publisherReleaseMedia,
  softwarePublicationMedia,
} = schema;

const SUB = "op-sub";
const EMAIL = "op@example.com";
const PNG_SHA = "a".repeat(64);

const notFoundStoreCatalog = {
  async getProductById(): Promise<{ ok: false; error: "not_found" }> {
    return { ok: false, error: "not_found" };
  },
};

function writes(): PublisherOperatorWrites {
  return new PublisherOperatorWrites({
    db,
    environment: "production",
    storeCatalog: notFoundStoreCatalog,
  });
}

function call<T>(input: T): OperatorCall<T> {
  return {
    input,
    meta: {
      actor: { sub: SUB, email: EMAIL },
      requestId: crypto.randomUUID(),
      idempotencyKey: crypto.randomUUID(),
    },
  };
}

// A capturing MediaStorage stub: drains the streamed body so the bytes crossing
// the port can be asserted, and returns a distinct private storage key.
function capturingStorage(result?: { ok: false; error: "unavailable" }): {
  media: MediaStorage;
  puts: number;
  last?: { key: string; bytes: number; sha256: string; contentType: string };
} {
  const box = {
    puts: 0,
    last: undefined as
      | { key: string; bytes: number; sha256: string; contentType: string }
      | undefined,
    media: {
      async put(input) {
        box.puts += 1;
        let bytes = 0;
        const reader = input.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) bytes += value.byteLength;
        }
        box.last = {
          key: input.key,
          bytes,
          sha256: input.sha256,
          contentType: input.contentType,
        };
        if (result) return result;
        return { ok: true as const, value: { key: `storage-${input.key}` } };
      },
      async read() {
        return { ok: true as const, value: new Response("bytes") };
      },
      async delete() {
        return { ok: true as const, value: undefined };
      },
    } satisfies MediaStorage,
  };
  return box;
}

function bytesStream(size: number): ReadableStream<Uint8Array> {
  return new Blob([new Uint8Array(size).fill(7)]).stream() as ReadableStream<Uint8Array>;
}

function ingestInput(
  overrides: Partial<{
    ownerType: "text" | "software" | "page";
    ownerId: string;
    contentType: string;
    size: number;
    role: string;
    alt: string;
  }> = {},
) {
  const size = overrides.size ?? 128;
  return {
    ownerType: overrides.ownerType ?? ("text" as const),
    ownerId: overrides.ownerId ?? "missing",
    body: bytesStream(size),
    contentType: overrides.contentType ?? "image/png",
    size,
    sha256: PNG_SHA,
    alt: overrides.alt ?? "a photo",
    role: overrides.role ?? "gallery",
    createdBySub: SUB,
  };
}

async function createTextOk(slug = "t"): Promise<string> {
  const res = await writes().createText(call({ slug, title: "Title" }));
  if (!res.ok) throw new Error(`createText failed: ${res.error}`);
  return res.value.textId;
}

async function createSoftwareOk(slug = "s"): Promise<string> {
  const res = await writes().createSoftware(call({ slug, title: "Tool" }));
  if (!res.ok) throw new Error(`createSoftware failed: ${res.error}`);
  return res.value.softwareId;
}

async function createPageOk(): Promise<string> {
  const res = await writes().createPage(
    call({ key: "about" as const, document: structuredClone(DEFAULT_PAGE_DOCUMENTS.about) }),
  );
  if (!res.ok) throw new Error(`createPage failed: ${res.error}`);
  return res.value.pageId;
}

beforeEach(async () => {
  await db.delete(publisherReleaseMedia);
  await db.delete(softwarePublicationMedia);
  await db.delete(publisherMedia);
  await db.delete(textEntry);
  await db.delete(softwareEntry);
  await db.delete(pageEntry);
  await db.delete(operatorEvent);
});

describe("ingestMedia — happy path", () => {
  test("writes a ready media row and returns the completed DTO", async () => {
    const textId = await createTextOk();
    const store = capturingStorage();

    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId, size: 256, role: "gallery" }),
      store.media,
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(store.puts).toBe(1);
    expect(store.last?.bytes).toBe(256);
    expect(store.last?.contentType).toBe("image/png");

    const dto = res.value;
    expect(dto.ownerType).toBe("text");
    expect(dto.ownerId).toBe(textId);
    expect(dto.state).toBe("ready");
    expect(dto.role).toBe("gallery");
    expect(dto.alt).toBe("a photo");
    expect(dto.position).toBe(0);
    expect(dto.size).toBe(256);
    expect(dto.sha256).toBe(PNG_SHA);
    expect(dto.href).toBe(`/media/${dto.id}`);

    // The row persists the private storage key returned by the port.
    const [row] = await db
      .select()
      .from(publisherMedia)
      .where(eq(publisherMedia.id, dto.id))
      .limit(1);
    expect(row?.state).toBe("ready");
    expect(row?.storageKey).toBe(`storage-${dto.id}`);
    expect(row?.createdBySub).toBe(SUB);
    expect(row?.readyAt).not.toBeNull();
  });

  test("the private storage_key never appears in the DTO", async () => {
    const textId = await createTextOk();
    const store = capturingStorage();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId }),
      store.media,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(JSON.stringify(res.value)).not.toContain("storage-");
    expect("storageKey" in res.value).toBe(false);
    expect("key" in res.value).toBe(false);
  });

  test("ingest writes no operator_event (storage lifecycle is not audited)", async () => {
    const textId = await createTextOk();
    await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId }),
      capturingStorage().media,
    );
    const events = await db.select().from(operatorEvent);
    expect(events.filter((e) => e.targetType === "media")).toHaveLength(0);
  });

  test("appends media at the next position per owner", async () => {
    const textId = await createTextOk();
    const store = capturingStorage();
    const first = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId }),
      store.media,
    );
    const second = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId }),
      store.media,
    );
    expect(first.ok && first.value.position).toBe(0);
    expect(second.ok && second.value.position).toBe(1);
  });

  test("resolves a page owner by PageKey to its internal id", async () => {
    const pageId = await createPageOk();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "page", ownerId: "about", role: "hero" }),
      capturingStorage().media,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // The stored owner_id is the page's internal id, not the PageKey.
    expect(res.value.ownerId).toBe(pageId);
    const [row] = await db
      .select()
      .from(publisherMedia)
      .where(and(eq(publisherMedia.ownerType, "page"), eq(publisherMedia.ownerId, pageId)))
      .limit(1);
    expect(row?.role).toBe("hero");
  });

  test("software owner resolves by id", async () => {
    const softwareId = await createSoftwareOk();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "software", ownerId: softwareId }),
      capturingStorage().media,
    );
    expect(res.ok && res.value.ownerId).toBe(softwareId);
  });
});

describe("ingestMedia — rejection", () => {
  test("owner missing → not_found, and nothing is stored", async () => {
    const store = capturingStorage();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: "does-not-exist" }),
      store.media,
    );
    expect(res).toEqual({ ok: false, error: "not_found" });
    expect(store.puts).toBe(0);
    expect(await db.select().from(publisherMedia)).toHaveLength(0);
  });

  test("page owner with an unknown PageKey → not_found", async () => {
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "page", ownerId: "nope" }),
      capturingStorage().media,
    );
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  test("unsupported content type → unsupported_type", async () => {
    const textId = await createTextOk();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId, contentType: "application/pdf" }),
      capturingStorage().media,
    );
    expect(res).toEqual({ ok: false, error: "unsupported_type" });
  });

  test("oversize → invalid_size", async () => {
    const textId = await createTextOk();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId, size: 100 * 1024 * 1024 + 1 }),
      capturingStorage().media,
    );
    expect(res).toEqual({ ok: false, error: "invalid_size" });
  });

  test("zero-byte → invalid_size", async () => {
    const textId = await createTextOk();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId, size: 0 }),
      capturingStorage().media,
    );
    expect(res).toEqual({ ok: false, error: "invalid_size" });
  });

  test("empty role → invalid_role", async () => {
    const textId = await createTextOk();
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId, role: "   " }),
      capturingStorage().media,
    );
    expect(res).toEqual({ ok: false, error: "invalid_role" });
  });

  test("storage failure → storage_unavailable, and no row is written", async () => {
    const textId = await createTextOk();
    const store = capturingStorage({ ok: false, error: "unavailable" });
    const res = await writes().ingestMedia(
      ingestInput({ ownerType: "text", ownerId: textId }),
      store.media,
    );
    expect(res).toEqual({ ok: false, error: "storage_unavailable" });
    expect(await db.select().from(publisherMedia)).toHaveLength(0);
  });
});
