/**
 * Same-origin, Access-protected store-media ingest (RFC-0001 D10 "Media
 * contracts"). Backs `POST /_operator/media/store/products/:productId`. The
 * browser sends `multipart/form-data` (`file`, `alt`, `role`, `commandId`);
 * Operator authenticates, computes the content hash, and streams the bytes to
 * Store over the service binding. Store validates, writes through its private
 * `MediaStorage` port, and returns the completed `ProductMediaDTO` — no
 * register / finalize / signed-URL / reference-id vocabulary crosses this
 * boundary (INV-MEDIA-1). Success → 201; validation → 400; not-found → 404;
 * storage failure → 503.
 *
 * Fails CLOSED: the Access actor is resolved FIRST, so an unauthenticated
 * request is rejected (403/500) before Store is ever touched. worker.ts already
 * gates every request at the boundary; re-resolving here keeps the route
 * fail-closed independent of the SSR pipeline.
 *
 * `resolve`/`store` are injectable so the handler is unit-testable under the
 * node runner without the Workers runtime; production supplies neither.
 */
import { type } from "arktype";
import { commandIdSchema } from "@si/contracts/operator";
import type {
  DomainResult,
  MediaMutationError,
  OperatorActor,
  ProductMediaDTO,
} from "@si/contracts";
import { resolveOperator, type AccessError } from "@/lib/access";
import type { OperatorEnv } from "@/operator-env";

/** The private Store ingest surface — deliberately NOT on
 *  `StoreOperatorEntrypoint` (the storage lifecycle is not an RPC method). */
export interface StoreMediaIngest {
  ingestProductMedia(input: {
    productId: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    size: number;
    sha256: string;
    alt: string;
    role: "cover" | "gallery" | "evidence";
  }): Promise<DomainResult<ProductMediaDTO, MediaMutationError>>;
}

type Resolver = (
  request: Request,
  env: OperatorEnv,
) => Promise<DomainResult<OperatorActor, AccessError>>;

interface Deps {
  resolve?: Resolver;
  store?: StoreMediaIngest;
}

const ROLES = new Set(["cover", "gallery", "evidence"]);

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bad(error: string): Response {
  return Response.json({ error }, { status: 400 });
}

export async function handleProductMediaUpload(
  request: Request,
  env: OperatorEnv,
  productId: string,
  deps: Deps = {},
): Promise<Response> {
  const resolve = deps.resolve ?? resolveOperator;
  const resolved = await resolve(request, env);
  if (!resolved.ok) {
    return new Response(resolved.error, { status: resolved.error === "misconfigured" ? 500 : 403 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("invalid_body");
  }

  const file = form.get("file");
  const alt = form.get("alt");
  const role = form.get("role");
  const commandId = form.get("commandId");

  // The browser supplies only an opaque UUID commandId (D7); no meta/actor field.
  if (typeof commandId !== "string" || commandIdSchema(commandId) instanceof type.errors) {
    return bad("invalid_command_id");
  }
  if (typeof role !== "string" || !ROLES.has(role)) return bad("invalid_role");
  if (typeof alt !== "string") return bad("invalid_alt");
  if (file === null || typeof file === "string" || typeof file.arrayBuffer !== "function") {
    return bad("invalid_file");
  }

  // Buffer once to hash: Web Crypto digest is single-shot over the full content.
  const buffer = await file.arrayBuffer();
  const size = buffer.byteLength;
  if (size === 0) return bad("invalid_size");
  const sha256 = hex(await crypto.subtle.digest("SHA-256", buffer));
  const contentType = file.type || "application/octet-stream";
  const body = new Blob([buffer], { type: contentType }).stream() as ReadableStream<Uint8Array>;

  const store = deps.store ?? (await defaultStore());
  const result = await store.ingestProductMedia({
    productId,
    body,
    contentType,
    size,
    sha256,
    alt,
    role: role as "cover" | "gallery" | "evidence",
  });

  if (result.ok) return Response.json(result.value, { status: 201 });
  const status =
    result.error === "storage_unavailable" ? 503 : result.error === "not_found" ? 404 : 400;
  return Response.json({ error: result.error, message: result.message }, { status });
}

async function defaultStore(): Promise<StoreMediaIngest> {
  // Lazy import keeps `cloudflare:workers` out of this module's static graph so
  // node unit tests import cleanly. The ingest method is not on the frozen
  // `StoreOperatorEntrypoint`, so the binding is asserted to the private ingest
  // shape here — the single place this cast lives.
  const { env } = await import("cloudflare:workers");
  return env.STORE as unknown as StoreMediaIngest;
}
