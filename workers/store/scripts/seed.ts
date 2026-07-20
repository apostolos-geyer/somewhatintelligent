#!/usr/bin/env bun
// Idempotent local-dev seed: one active demo product (base + draft + a
// published release) with two in-stock variant sizes, so the storefront grid
// and Operator's catalog aren't empty on first boot. Fixed ids + INSERT OR
// IGNORE make re-runs a no-op. Local D1 only (see scripts/dev-config d1Exec).
import { resolve, dirname } from "node:path";
import { d1Exec } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const now = Date.now();

const PRODUCT_ID = "seed-prod-fieldtee";
const RELEASE_ID = "seed-rel-fieldtee-1";

// 1. Base identity row (status starts draft; flipped to active + pointed at
//    the release once it exists — active_release_id FKs into product_release).
d1Exec(
  pkgDir,
  `INSERT OR IGNORE INTO product
     (id, slug, status, created_by_sub, created_at, updated_at)
   VALUES
     ('${PRODUCT_ID}', 'field-notes-tee', 'draft', 'seed', ${now}, ${now});`,
);

// 2. Editable working copy (Operator's catalog form reads this).
d1Exec(
  pkgDir,
  `INSERT OR IGNORE INTO product_draft
     (product_id, revision, title, description_markdown, price_cents, updated_by_sub, updated_at)
   VALUES
     ('${PRODUCT_ID}', 1, 'Field Notes Tee',
      'A heavyweight tee rendered as a technical drawing.', 3800, 'seed', ${now});`,
);

// 3. Published release (public/checkout reads source title + price from here).
d1Exec(
  pkgDir,
  `INSERT OR IGNORE INTO product_release
     (id, product_id, version, slug, title, description_markdown, price_cents, published_by_sub, published_at)
   VALUES
     ('${RELEASE_ID}', '${PRODUCT_ID}', '1', 'field-notes-tee', 'Field Notes Tee',
      'A heavyweight tee rendered as a technical drawing.', 3800, 'seed', ${now});`,
);

// 4. Publish: flip the base row active and point it at the release.
d1Exec(
  pkgDir,
  `UPDATE product SET status = 'active', active_release_id = '${RELEASE_ID}', updated_at = ${now}
   WHERE id = '${PRODUCT_ID}' AND active_release_id IS NULL;`,
);

const variants: Array<[string, string, string, number]> = [
  ["seed-var-ft-m", "M", "FIELD-NOTES-TEE-M", 24],
  ["seed-var-ft-l", "L", "FIELD-NOTES-TEE-L", 18],
];
for (const [id, size, sku, stock] of variants) {
  d1Exec(
    pkgDir,
    `INSERT OR IGNORE INTO product_variant (id, product_id, size, sku, stock, created_at)
     VALUES ('${id}', '${PRODUCT_ID}', '${size}', '${sku}', ${stock}, ${now});`,
  );
}

// 6. Product imagery — two tiny deterministic PNGs (1×1 solid colors, built as
//    base64 constants so the seed needs no assets or deps) so the storefront
//    grid + detail page render REAL images offline. Each image is a full Roadie
//    round-trip: bytes are pushed into roadie's miniflare R2 sim over its
//    dev-only `PUT /__dev/blob/<physicalBlobId>` HTTP route (same running worker
//    the read path serves from), and the matching roadie `physical_blob` +
//    `blob_reference` rows are seeded so `getReadUrl({ referenceId })` resolves.
//    The store `product_image.storage_key` IS the roadie referenceId (D10 key
//    reconciliation), and the `product_release_image` snapshot surfaces the
//    image on the ACTIVE release. Ids are fixed and every write is INSERT OR
//    IGNORE / an idempotent R2 overwrite, so re-runs are a no-op.
const roadieDir = resolve(pkgDir, "..", "roadie");
// The seed writes bytes to the SAME running roadie process the read path reads
// from (one env.BLOBS sim), so any origin that reaches it works; the direct dev
// port avoids the portless TLS/proxy hop. Override with ROADIE_DEV_ORIGIN.
const roadieOrigin =
  process.env.ROADIE_DEV_ORIGIN ?? `http://127.0.0.1:${process.env.ROADIE_PORT ?? "8790"}`;

interface SeedImage {
  mediaId: string; // store product_image.id (the public media id in /api/store/media/<id>)
  refId: string; // roadie blob_reference.id === store product_image.storage_key
  physId: string; // roadie physical_blob.id === R2 object key === dev-blob URL id
  role: "cover" | "gallery";
  position: number;
  alt: string;
  base64: string; // PNG bytes
}

const images: SeedImage[] = [
  {
    mediaId: "seed-img-fieldtee-cover",
    refId: "seed-ref-fieldtee-cover",
    physId: "seed-pb-fieldtee-cover",
    role: "cover",
    position: 0,
    alt: "Field Notes Tee — front",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mM4oaEBAALUARk7rVwIAAAAAElFTkSuQmCC",
  },
  {
    mediaId: "seed-img-fieldtee-gallery",
    refId: "seed-ref-fieldtee-gallery",
    physId: "seed-pb-fieldtee-gallery",
    role: "gallery",
    position: 1,
    alt: "Field Notes Tee — detail",
    base64:
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mPQCDgBAAHkAUEmfyMLAAAAAElFTkSuQmCC",
  },
];

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

let seededImages = 0;
for (const img of images) {
  const bytes = Uint8Array.from(atob(img.base64), (c) => c.charCodeAt(0));
  const hash = await sha256Hex(bytes);
  const size = bytes.byteLength;

  // Push bytes into roadie's R2 sim first — only seed the D1 rows that point at
  // them once the bytes are actually present, so a down roadie never leaves the
  // catalog referencing a blob that will not resolve.
  try {
    const res = await fetch(`${roadieOrigin}/__dev/blob/${img.physId}`, {
      method: "PUT",
      headers: { "content-type": "image/png" },
      body: bytes,
    });
    if (!res.ok) throw new Error(`roadie PUT ${res.status}`);
  } catch (e) {
    console.log(
      `  [seed] workers/store: roadie unreachable at ${roadieOrigin} (${
        e instanceof Error ? e.message : String(e)
      }) — skipping image '${img.mediaId}'`,
    );
    continue;
  }

  // Roadie: the physical blob (finalized, ready) + the store's caller-scoped
  // reference handle. content_type lives on the reference (per-consumer label).
  d1Exec(
    roadieDir,
    `INSERT OR IGNORE INTO physical_blob
       (id, hash, size, upload_mode, part_size, part_count, r2_upload_id,
        enforce_checksum, refcount, created_at, finalized_at, deleted_at)
     VALUES
       ('${img.physId}', '${hash}', ${size}, 'server', NULL, NULL, NULL,
        0, 1, ${now}, ${now}, NULL);`,
  );
  d1Exec(
    roadieDir,
    `INSERT OR IGNORE INTO blob_reference
       (id, physical_blob_id, app, resource_type, resource_id, caller_app, content_type, created_at)
     VALUES
       ('${img.refId}', '${img.physId}', 'storefront', 'product_image',
        '${img.mediaId}', 'store', 'image/png', ${now});`,
  );

  // Store: the live image (ready) + its frozen snapshot on the active release.
  d1Exec(
    pkgDir,
    `INSERT OR IGNORE INTO product_image
       (id, product_id, storage_key, content_sha256, content_type, size_bytes,
        width, height, alt, role, position, state, created_at, ready_at)
     VALUES
       ('${img.mediaId}', '${PRODUCT_ID}', '${img.refId}', '${hash}', 'image/png', ${size},
        1, 1, '${img.alt}', '${img.role}', ${img.position}, 'ready', ${now}, ${now});`,
  );
  d1Exec(
    pkgDir,
    `INSERT OR IGNORE INTO product_release_image
       (release_id, image_id, alt, role, position)
     VALUES
       ('${RELEASE_ID}', '${img.mediaId}', '${img.alt}', '${img.role}', ${img.position});`,
  );
  seededImages++;
}

console.log(
  `  [seed] workers/store: demo product 'Field Notes Tee' (M/L) ready` +
    ` — ${seededImages}/${images.length} images through roadie`,
);
