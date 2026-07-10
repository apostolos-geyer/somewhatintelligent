// Product-image upload server functions — admin-only. These thinly wrap
// Roadie's RPC surface (registerUpload → [signPart/recordPart] → finalize).
// The browser drives the byte transfer with `runUpload`; we only mint signed
// URLs and persist the product_image row keyed by Roadie's referenceId.
import { createServerFn } from "@tanstack/react-start";
import { asc, eq } from "drizzle-orm";
import { type } from "arktype";

import { product, productImage } from "@/db/schema";
import { getDb } from "@/lib/db";
import { ulid } from "@somewhatintelligent/kit/ids";
import { getRoadie } from "@/lib/roadie";
import { requireAdminMiddleware } from "@/lib/middleware/auth";
import { NotFoundError } from "@/lib/errors";

const registerInput = type({
  productId: "string",
  size: "number.integer >= 0",
  contentType: "string <= 255",
  sha256: /^[a-f0-9]{64}$/,
  "alt?": "string <= 255",
});

export type RegisterImageResult =
  | { ok: false; error: string; message?: string }
  | {
      ok: true;
      imageId: string;
      upload:
        | { status: "ready" }
        | {
            status: "single-part";
            uploadUrl: string;
            requiredHeaders: Record<string, string>;
            expiresAt: number;
          }
        | {
            status: "multipart";
            uploadId: string;
            partSize: number;
            partCount: number;
            expiresAt: number;
          };
    };

export const registerProductImage = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof registerInput.infer) => registerInput.assert(data))
  .handler(async ({ data, context }): Promise<RegisterImageResult> => {
    const db = getDb();
    const [p] = await db.select().from(product).where(eq(product.id, data.productId)).limit(1);
    if (!p) throw new NotFoundError();

    const imageId = ulid();
    const result = await getRoadie().registerUpload(
      {
        hash: data.sha256,
        size: data.size,
        contentType: data.contentType,
        application: { app: "storefront", resourceType: "product_image", resourceId: imageId },
      },
      { kind: "user", userId: context.session.user.id },
    );
    if (!result.ok) return { ok: false, error: result.error, message: result.message };
    const value = result.value;

    // Next position = current max + 1.
    const existing = await db
      .select({ position: productImage.position })
      .from(productImage)
      .where(eq(productImage.productId, data.productId))
      .orderBy(asc(productImage.position));
    const nextPos = existing.length ? Math.max(...existing.map((e) => e.position)) + 1 : 0;
    const now = new Date();
    await db.insert(productImage).values({
      id: imageId,
      productId: data.productId,
      roadieReferenceId: value.referenceId,
      alt: data.alt ?? null,
      position: nextPos,
      uploadedAt: value.status === "ready" ? now : null,
      createdAt: now,
    });

    if (value.status === "ready") return { ok: true, imageId, upload: { status: "ready" } };
    if (value.status === "single-part") {
      return {
        ok: true,
        imageId,
        upload: {
          status: "single-part",
          uploadUrl: value.upload.uploadUrl,
          requiredHeaders: value.upload.requiredHeaders,
          expiresAt: value.upload.expiresAt,
        },
      };
    }
    return {
      ok: true,
      imageId,
      upload: {
        status: "multipart",
        uploadId: value.uploadId,
        partSize: value.partSize,
        partCount: value.partCount,
        expiresAt: value.expiresAt,
      },
    };
  });

const signPartInput = type({
  imageId: "string",
  partNumber: "number.integer >= 1",
  size: "number.integer >= 0",
});

export const signProductImagePart = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof signPartInput.infer) => signPartInput.assert(data))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const [img] = await db
      .select()
      .from(productImage)
      .where(eq(productImage.id, data.imageId))
      .limit(1);
    if (!img) throw new NotFoundError();
    const r = await getRoadie().signPart(
      { referenceId: img.roadieReferenceId, partNumber: data.partNumber, size: data.size },
      { kind: "user", userId: context.session.user.id },
    );
    if (!r.ok) return { ok: false as const, error: r.error };
    return {
      ok: true as const,
      uploadUrl: r.value.uploadUrl,
      requiredHeaders: r.value.requiredHeaders,
    };
  });

const recordPartInput = type({
  imageId: "string",
  partNumber: "number.integer >= 1",
  etag: "string",
  size: "number.integer >= 0",
});

export const recordProductImagePart = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: typeof recordPartInput.infer) => recordPartInput.assert(data))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const [img] = await db
      .select()
      .from(productImage)
      .where(eq(productImage.id, data.imageId))
      .limit(1);
    if (!img) throw new NotFoundError();
    const r = await getRoadie().recordPart(
      {
        referenceId: img.roadieReferenceId,
        partNumber: data.partNumber,
        etag: data.etag,
        size: data.size,
      },
      { kind: "user", userId: context.session.user.id },
    );
    if (!r.ok) return { ok: false as const, error: r.error };
    return { ok: true as const };
  });

export const finalizeProductImage = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { imageId: string }) => type({ imageId: "string" }).assert(data))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const [img] = await db
      .select()
      .from(productImage)
      .where(eq(productImage.id, data.imageId))
      .limit(1);
    if (!img) throw new NotFoundError();
    const r = await getRoadie().finalize(
      { referenceId: img.roadieReferenceId },
      { kind: "user", userId: context.session.user.id },
    );
    if (!r.ok) return { ok: false as const, error: r.error };
    await db
      .update(productImage)
      .set({ uploadedAt: new Date() })
      .where(eq(productImage.id, img.id));
    return { ok: true as const };
  });

export const deleteProductImage = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { imageId: string }) => type({ imageId: "string" }).assert(data))
  .handler(async ({ data, context }) => {
    const db = getDb();
    const [img] = await db
      .select()
      .from(productImage)
      .where(eq(productImage.id, data.imageId))
      .limit(1);
    if (!img) throw new NotFoundError();
    // Drop the Roadie reference (best-effort — refcount/GC is Roadie's job).
    await getRoadie()
      .removeReference(
        { referenceId: img.roadieReferenceId },
        { kind: "user", userId: context.session.user.id },
      )
      .catch(() => {});
    await db.delete(productImage).where(eq(productImage.id, img.id));
    return { ok: true as const };
  });
