// ULID-flavored identifier: 48-bit timestamp + 80 bits of random. Generated
// using Crockford Base32 — sortable by creation time, URL-safe, opaque.
// Used for blob, physical_blob, blob_reference, blob_multipart_part,
// deletion_queue, and signed_url_cache ids. Backend (R2) keys are physical
// blob ids directly (RFC §8 — R2 key naming).

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(ms: number): string {
  let t = ms;
  const out: string[] = [];
  for (let i = 9; i >= 0; i--) {
    out[i] = CROCKFORD[t % 32] as string;
    t = Math.floor(t / 32);
  }
  return out.join("");
}

function encodeRandom(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // 16 random bytes → 16 Base32 characters by masking each byte to 5 bits.
  // We consume only 80 bits total; the extra bytes give room for variation
  // without needing cross-byte bit-packing. Keep simple and correct.
  let out = "";
  for (let i = 0; i < 16; i++) {
    out += CROCKFORD[(bytes[i] as number) & 31];
  }
  return out;
}

export function newId(): string {
  return encodeTime(Date.now()) + encodeRandom();
}
