import { describe, expect, test } from "vitest";

import type { MediaStorage, StorageResult } from "@/lib/media-storage";
import {
  createRoadieMediaStorage,
  STORE_MEDIA_APPLICATION,
  type RoadieMediaClient,
} from "@/lib/media-storage-roadie";

// Stubbed Roadie client — no binding, no network, no workerd. Records every
// call so tests assert the exact translation the adapter performs.
function stubRoadie(overrides: Partial<RoadieMediaClient> = {}) {
  const calls: Array<{ method: string; input: unknown }> = [];
  const client: RoadieMediaClient = {
    put: async (input) => {
      calls.push({ method: "put", input });
      return { ok: true, value: { referenceId: "ref_minted_1", blobId: "blob_1", deduped: false } };
    },
    getReadUrl: async (input) => {
      calls.push({ method: "getReadUrl", input });
      return {
        ok: true,
        value: {
          url: "https://blobs.example/signed-get",
          expiresAt: 1_900_000_000_000,
          cached: false,
        },
      };
    },
    removeReference: async (input) => {
      calls.push({ method: "removeReference", input });
      return { ok: true, value: null };
    },
    ...overrides,
  };
  return { client, calls };
}

const SHA256 = "a".repeat(64);

function makeStorage(overrides: Partial<RoadieMediaClient> = {}) {
  const { client, calls } = stubRoadie(overrides);
  const storage = createRoadieMediaStorage(client, {
    application: STORE_MEDIA_APPLICATION,
  });
  return { storage, calls };
}

function bodyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

describe("Roadie MediaStorage adapter — put", () => {
  test("translates to the server-side roadie put and returns the minted referenceId as key", async () => {
    const { storage, calls } = makeStorage();
    const body = bodyStream();
    const result = await storage.put({
      key: "media-row-id",
      body,
      contentType: "image/png",
      size: 3,
      sha256: SHA256,
    });
    expect(result).toEqual({ ok: true, value: { key: "ref_minted_1" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("put");
    expect(calls[0]?.input).toEqual({
      hash: SHA256,
      size: 3,
      contentType: "image/png",
      application: { app: "storefront", resourceType: "product_image", resourceId: "media-row-id" },
      body,
    });
  });

  test("honors the caller's application tuple", async () => {
    const { client, calls } = stubRoadie();
    const storage = createRoadieMediaStorage(client, {
      application: { app: "storefront", resourceType: "evidence" },
    });
    await storage.put({
      key: "m1",
      body: bodyStream(),
      contentType: "image/jpeg",
      size: 3,
      sha256: SHA256,
    });
    expect(calls[0]?.input).toMatchObject({
      application: { app: "storefront", resourceType: "evidence", resourceId: "m1" },
    });
  });

  test.each([
    ["backend_unavailable"],
    ["size_exceeds_limit"],
    ["invalid_hash"],
    ["hash_mismatch"],
    ["size_mismatch"],
  ] as const)("roadie put error %s maps to unavailable", async (error) => {
    const { storage } = makeStorage({
      put: async () => ({ ok: false, error }),
    });
    const result = await storage.put({
      key: "m1",
      body: bodyStream(),
      contentType: "image/png",
      size: 3,
      sha256: SHA256,
    });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });

  test("a thrown RPC exception maps to unavailable", async () => {
    const { storage } = makeStorage({
      put: async () => {
        throw new Error("rpc down");
      },
    });
    const result = await storage.put({
      key: "m1",
      body: bodyStream(),
      contentType: "image/png",
      size: 3,
      sha256: SHA256,
    });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("Roadie MediaStorage adapter — read", () => {
  test("resolves a read URL and produces a redirect Response", async () => {
    const { storage, calls } = makeStorage();
    const result = await storage.read({ key: "ref_minted_1" });
    expect(calls[0]?.method).toBe("getReadUrl");
    expect(calls[0]?.input).toMatchObject({
      referenceId: "ref_minted_1",
      permissionScope: "public",
    });
    if (!result.ok) throw new Error("expected ok");
    // The port yields an opaque Response; the URL stays a transport detail.
    expect(result.value).toBeInstanceOf(Response);
    expect(result.value.status).toBe(302);
    expect(result.value.headers.get("location")).toBe("https://blobs.example/signed-get");
  });

  test.each([["reference_not_found"], ["not_ready"], ["deleted"]] as const)(
    "roadie read error %s maps to not_found",
    async (error) => {
      const { storage } = makeStorage({
        getReadUrl: async () => ({ ok: false, error }),
      });
      const result = await storage.read({ key: "gone" });
      expect(result).toEqual({ ok: false, error: "not_found" });
    },
  );

  test("adapter misconfiguration (invalid_lifetime) maps to unavailable", async () => {
    const { storage } = makeStorage({
      getReadUrl: async () => ({ ok: false, error: "invalid_lifetime" }),
    });
    const result = await storage.read({ key: "ref" });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });

  test("a thrown RPC exception maps to unavailable", async () => {
    const { storage } = makeStorage({
      getReadUrl: async () => {
        throw new Error("rpc down");
      },
    });
    const result = await storage.read({ key: "ref" });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("Roadie MediaStorage adapter — delete", () => {
  test("calls removeReference with the key", async () => {
    const { storage, calls } = makeStorage();
    const result = await storage.delete({ key: "ref_minted_1" });
    expect(result).toEqual({ ok: true, value: undefined });
    expect(calls).toEqual([{ method: "removeReference", input: { referenceId: "ref_minted_1" } }]);
  });

  test("a thrown RPC exception maps to unavailable", async () => {
    const { storage } = makeStorage({
      removeReference: async () => {
        throw new Error("rpc down");
      },
    });
    const result = await storage.delete({ key: "ref" });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });

  test.each([["reference_not_found"], ["deleted"]] as const)(
    "already-gone error %s passes through as not_found so the GC drain can retire the row",
    async (error) => {
      const { storage } = makeStorage({
        removeReference: async () => ({ ok: false, error }),
      });
      const result = await storage.delete({ key: "gone" });
      expect(result).toEqual({ ok: false, error: "not_found" });
    },
  );

  test("an unrecognized removeReference error maps to unavailable (transient)", async () => {
    const { storage } = makeStorage({
      removeReference: async () => ({ ok: false, error: "backend_unavailable" }),
    });
    const result = await storage.delete({ key: "ref" });
    expect(result).toEqual({ ok: false, error: "unavailable" });
  });
});

describe("port surface — no Roadie vocabulary crosses it (INV-MEDIA-1 / D10)", () => {
  const FORBIDDEN =
    /referenceId|blobId|signedUrl|uploadUrl|uploadId|multipart|finalize|register|signPart|recordPart|presign/;

  test("the adapter exposes exactly put/read/delete", () => {
    const { storage } = makeStorage();
    expect(Object.keys(storage).sort()).toEqual(["delete", "put", "read"]);
  });

  test("result payloads serialize without register/finalize/signed-url/reference-id concepts", async () => {
    const { storage } = makeStorage();
    const putResult = await storage.put({
      key: "m1",
      body: bodyStream(),
      contentType: "image/png",
      size: 3,
      sha256: SHA256,
    });
    const deleteResult = await storage.delete({ key: "m1" });
    for (const result of [putResult, deleteResult]) {
      expect(JSON.stringify(result)).not.toMatch(FORBIDDEN);
    }
    if (putResult.ok) expect(Object.keys(putResult.value)).toEqual(["key"]);

    const readResult = await storage.read({ key: "m1" });
    if (!readResult.ok) throw new Error("expected ok");
    // A Response is opaque to JSON; the value carries no DTO fields at all.
    expect(JSON.stringify(readResult)).not.toMatch(FORBIDDEN);
  });

  test("type: MediaStorage's public keys are exactly put/read/delete", () => {
    expect(true).toBe(true);
  });
});

// Type-level assertions (checked by tsgo — store's tsconfig includes
// __tests__): MediaStorage's public keys are exactly put/read/delete, and its
// error union is exactly unavailable/not_found.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type AssertTrue<T extends true> = T;
export type _MethodsAreExactlyThePort = AssertTrue<
  Equal<keyof MediaStorage, "put" | "read" | "delete">
>;
export type _ErrorIsThePortUnion = AssertTrue<
  Equal<Extract<StorageResult<unknown>, { ok: false }>["error"], "unavailable" | "not_found">
>;
