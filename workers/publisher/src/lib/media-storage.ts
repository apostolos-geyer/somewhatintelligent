/**
 * MediaStorage port — RFC-0001 D10 + "Media contracts". This shape is
 * normative and frozen: every backend implements it EXACTLY, and it is
 * deliberately NOT exported from @si/contracts (the port is private to each
 * backend — only domain DTOs cross RPC boundaries).
 *
 * The port hides the entire storage-provider lifecycle — registration,
 * multipart, finalization, signed reads, reference ids, garbage collection —
 * behind three methods (INV-MEDIA-1). `key` is a private persistence detail:
 * it never appears in a DTO, a public URL, or an RPC contract type. Callers
 * persist the `key` returned by put() as their media row's storage_key and
 * use it for every later read/delete.
 */
export interface MediaStorage {
  put(input: {
    key: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    size: number;
    sha256: string;
  }): Promise<StorageResult<{ key: string }>>;
  read(input: { key: string }): Promise<StorageResult<Response>>;
  delete(input: { key: string }): Promise<StorageResult<void>>;
}

export type StorageResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: "unavailable" | "not_found" };
