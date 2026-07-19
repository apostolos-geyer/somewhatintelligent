import type {
  DomainResult,
  MediaMutationError,
  OperatorActor,
  ProductMediaDTO,
} from "@si/contracts";
import { handleProductMediaUpload, type StoreMediaIngest } from "../src/lib/media-ingest";
import type { OperatorEnv } from "../src/operator-env";

// T19 same-origin media ingest (RFC-0001 D10). The handler is exercised with a
// real multipart Request and injected `resolve`/`store`, proving: (1) it fails
// CLOSED before Store is touched, (2) a byte-oriented ReadableStream survives
// being passed as the RPC `body` argument and reads back byte-identical with a
// matching sha256, and (3) typed store errors map to 201/400/404/503.

const ENV = { ENVIRONMENT: "development", OPERATOR_URL: "https://desk.test" } as OperatorEnv;
const ACTOR: OperatorActor = { sub: "op-1", email: "op@example.com" };
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5, 6, 7, 8]);

const allow = async () => ({ ok: true as const, value: ACTOR });
const deny = async () => ({ ok: false as const, error: "unauthorized" as const });
const misconfigured = async () => ({ ok: false as const, error: "misconfigured" as const });

const DTO: ProductMediaDTO = {
  id: "media-1",
  productId: "prod-1",
  alt: "a shirt",
  role: "gallery",
  position: 0,
  state: "ready",
  href: "/api/store/media/media-1",
  contentType: "image/png",
  size: PNG.byteLength,
  sha256: "x",
  width: null,
  height: null,
};

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function concat(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** A capturing store stub: drains the streamed body so we can assert the bytes
 *  cross the boundary intact, then returns a configurable result. */
function capturingStore(
  result: DomainResult<ProductMediaDTO, MediaMutationError> = { ok: true, value: DTO },
): {
  store: StoreMediaIngest;
  calls: number;
  received?: { input: Parameters<StoreMediaIngest["ingestProductMedia"]>[0]; bytes: Uint8Array };
} {
  const box = {
    calls: 0,
    received: undefined as
      | { input: Parameters<StoreMediaIngest["ingestProductMedia"]>[0]; bytes: Uint8Array }
      | undefined,
    store: {
      async ingestProductMedia(input) {
        box.calls += 1;
        const bytes = await concat(input.body);
        box.received = { input, bytes };
        return result;
      },
    } satisfies StoreMediaIngest,
  };
  return box;
}

function upload(fields: {
  file?: Uint8Array;
  fileType?: string;
  alt?: string;
  role?: string;
  commandId?: string;
}): Request {
  const fd = new FormData();
  if (fields.file) {
    fd.set("file", new Blob([fields.file], { type: fields.fileType ?? "image/png" }), "photo.png");
  }
  if (fields.alt !== undefined) fd.set("alt", fields.alt);
  if (fields.role !== undefined) fd.set("role", fields.role);
  if (fields.commandId !== undefined) fd.set("commandId", fields.commandId);
  return new Request("https://desk.test/_operator/media/store/products/prod-1", {
    method: "POST",
    body: fd,
  });
}

function goodFields() {
  return {
    file: PNG,
    fileType: "image/png",
    alt: "a shirt",
    role: "gallery",
    commandId: crypto.randomUUID(),
  };
}

describe("handleProductMediaUpload — fail closed", () => {
  test("an unauthenticated request is 403 and never touches Store", async () => {
    const s = capturingStore();
    const res = await handleProductMediaUpload(upload(goodFields()), ENV, "prod-1", {
      resolve: deny,
      store: s.store,
    });
    expect(res.status).toBe(403);
    expect(await res.text()).toBe("unauthorized");
    expect(s.calls).toBe(0);
  });

  test("a misconfigured environment is 500 and never touches Store", async () => {
    const s = capturingStore();
    const res = await handleProductMediaUpload(upload(goodFields()), ENV, "prod-1", {
      resolve: misconfigured,
      store: s.store,
    });
    expect(res.status).toBe(500);
    expect(s.calls).toBe(0);
  });
});

describe("handleProductMediaUpload — happy path streams to Store", () => {
  test("forwards the ReadableStream body byte-identical with a matching sha256", async () => {
    const s = capturingStore();
    const commandId = crypto.randomUUID();
    const res = await handleProductMediaUpload(
      upload({ file: PNG, fileType: "image/png", alt: "a shirt", role: "cover", commandId }),
      ENV,
      "prod-1",
      { resolve: allow, store: s.store },
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(DTO);
    expect(s.calls).toBe(1);

    const got = s.received!;
    expect(Array.from(got.bytes)).toEqual(Array.from(PNG)); // stream crossed intact
    expect(got.input.size).toBe(PNG.byteLength);
    expect(got.input.contentType).toBe("image/png");
    expect(got.input.role).toBe("cover");
    expect(got.input.alt).toBe("a shirt");
    expect(got.input.productId).toBe("prod-1");
    expect(got.input.sha256).toBe(hex(await crypto.subtle.digest("SHA-256", PNG)));
  });
});

describe("handleProductMediaUpload — validation is 400 before Store", () => {
  test("rejects a non-image / but store validates type; here: missing file", async () => {
    const s = capturingStore();
    const res = await handleProductMediaUpload(
      upload({ alt: "x", role: "gallery", commandId: crypto.randomUUID() }),
      ENV,
      "prod-1",
      { resolve: allow, store: s.store },
    );
    expect(res.status).toBe(400);
    expect(s.calls).toBe(0);
  });

  test("rejects an unknown role", async () => {
    const s = capturingStore();
    const res = await handleProductMediaUpload(
      upload({ ...goodFields(), role: "banner" }),
      ENV,
      "prod-1",
      { resolve: allow, store: s.store },
    );
    expect(res.status).toBe(400);
    expect(s.calls).toBe(0);
  });

  test("rejects a non-UUID commandId", async () => {
    const s = capturingStore();
    const res = await handleProductMediaUpload(
      upload({ ...goodFields(), commandId: "not-a-uuid" }),
      ENV,
      "prod-1",
      { resolve: allow, store: s.store },
    );
    expect(res.status).toBe(400);
    expect(s.calls).toBe(0);
  });

  test("rejects a zero-byte file", async () => {
    const s = capturingStore();
    const res = await handleProductMediaUpload(
      upload({ ...goodFields(), file: new Uint8Array(0) }),
      ENV,
      "prod-1",
      { resolve: allow, store: s.store },
    );
    expect(res.status).toBe(400);
    expect(s.calls).toBe(0);
  });
});

describe("handleProductMediaUpload — store error mapping", () => {
  test("storage_unavailable → 503", async () => {
    const s = capturingStore({ ok: false, error: "storage_unavailable" });
    const res = await handleProductMediaUpload(upload(goodFields()), ENV, "prod-1", {
      resolve: allow,
      store: s.store,
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "storage_unavailable" });
  });

  test("not_found → 404", async () => {
    const s = capturingStore({ ok: false, error: "not_found" });
    const res = await handleProductMediaUpload(upload(goodFields()), ENV, "prod-1", {
      resolve: allow,
      store: s.store,
    });
    expect(res.status).toBe(404);
  });

  test("unsupported_type → 400", async () => {
    const s = capturingStore({ ok: false, error: "unsupported_type" });
    const res = await handleProductMediaUpload(upload(goodFields()), ENV, "prod-1", {
      resolve: allow,
      store: s.store,
    });
    expect(res.status).toBe(400);
  });
});
