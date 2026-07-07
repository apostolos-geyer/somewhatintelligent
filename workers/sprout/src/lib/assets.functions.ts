/**
 * Store-asset server functions (P1.D) — the downloadable library + its admin
 * management surface. Two tenancy modes, per the §02 invariant (brand_id is
 * NEVER input):
 *
 *  - The budtender reads/downloads (`listAssets`, `getAssetReadUrl`,
 *    `recordDownload`) gate with `requireUserMiddleware` and scope every row to
 *    the verified envelope's `activeOrgId`. An asset is only served if its
 *    `brand_id === activeOrgId` — a forged `assetId` from another brand resolves
 *    to "not found", never another brand's blob.
 *  - The Brand-Admin mutations (`registerAssetUpload`, `finalizeAssetUpload`,
 *    `upsertAssetMeta`, `archiveAsset`) additionally gate IN-HANDLER on
 *    `decideBrandAdmin({ actorRole, orgRole })` (owner|admin in the brand's BA
 *    org, or platform admin). Every mutation calls `writeAudit` in the same
 *    logical write.
 *
 * The file bytes are an R2 blob (roadie); D1 holds the metadata + the reference
 * handle (`file_ref`). Roadie blob I/O needs R2 secrets (inert in local dev), so
 * the upload/finalize/read-url calls are wrapped — a metadata row still lands,
 * and the read paths degrade to a null URL (the viewer shows a "preview needs R2"
 * note rather than a broken frame).
 *
 * `download_count` is a denormalized counter bumped in the SAME logical write as
 * the `asset_download` analytics event (analytics.ts §counter contract).
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { assets } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { getRoadie } from "@/lib/roadie";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";

/** The four opener types — drives the in-platform viewer + the read disposition. */
export const ASSET_TYPES = ["pdf", "image", "video", "zip"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export function isAssetType(v: unknown): v is AssetType {
  return typeof v === "string" && (ASSET_TYPES as readonly string[]).includes(v);
}

/** A published library asset as the budtender grid renders it. */
export interface AssetView {
  id: string;
  name: string;
  category: string | null;
  type: AssetType;
  sizeBytes: number;
  downloadCount: number;
  physicalAvailable: boolean;
  physicalMaxQty: number | null;
  /** Whether a thumbnail blob exists — the card fetches its signed URL lazily. */
  hasThumb: boolean;
}

/** The admin-library projection — adds lifecycle fields the budtender never sees. */
export interface AdminAssetView extends AssetView {
  fileRef: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
}

// Drizzle returns rows keyed by the schema's camelCase TS fields; the projection
// below selects exactly the columns the views need, mapped at the I/O edge.
type AssetRow = {
  id: string;
  name: string;
  category: string | null;
  type: string;
  fileRef: string;
  thumbRef: string | null;
  sizeBytes: number;
  downloadCount: number;
  physicalAvailable: number;
  physicalMaxQty: number | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
};

/** Narrow D1's untyped `type` string to the closed `AssetType` set (default pdf). */
function asAssetType(v: string): AssetType {
  return isAssetType(v) ? v : "pdf";
}

function mapView(row: AssetRow): AssetView {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    type: asAssetType(row.type),
    sizeBytes: row.sizeBytes,
    downloadCount: row.downloadCount,
    physicalAvailable: row.physicalAvailable !== 0,
    physicalMaxQty: row.physicalMaxQty,
    hasThumb: !!row.thumbRef?.trim() && !row.thumbRef.startsWith("pending:"),
  };
}

function mapAdminView(row: AssetRow): AdminAssetView {
  return {
    ...mapView(row),
    fileRef: row.fileRef,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

/** roadie content disposition by type — pdf/image/video preview inline; zip downloads. */
function dispositionFor(type: AssetType): "inline" | "attachment" {
  return type === "zip" ? "attachment" : "inline";
}

// ─── budtender reads (authenticated, envelope-scoped) ───────────────────────

// The shared column projection — exactly the fields the view mappers read.
const ASSET_COLS = {
  id: assets.id,
  name: assets.name,
  category: assets.category,
  type: assets.type,
  fileRef: assets.fileRef,
  thumbRef: assets.thumbRef,
  sizeBytes: assets.sizeBytes,
  downloadCount: assets.downloadCount,
  physicalAvailable: assets.physicalAvailable,
  physicalMaxQty: assets.physicalMaxQty,
  status: assets.status,
  createdAt: assets.createdAt,
  updatedAt: assets.updatedAt,
  archivedAt: assets.archivedAt,
} as const;

/**
 * Gated: the caller's brand's published, non-archived assets, ordered by category
 * then name so the grid groups cleanly. brand = envelope `activeOrgId`, never
 * input. No active org → empty list (the section renders its empty state).
 */
export const listAssets = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<AssetView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const rows = await db
      .select(ASSET_COLS)
      .from(assets)
      .where(
        and(eq(assets.brandId, brandId), eq(assets.status, "published"), isNull(assets.archivedAt)),
      )
      .orderBy(asc(assets.category), asc(assets.name), asc(assets.id));

    return rows.map(mapView);
  });

const assetIdInput = type({ assetId: "string >= 1" });

/** Verify the asset belongs to `brandId` and return its file/thumb refs + `type`. */
async function loadOwnedAsset(
  assetId: string,
  brandId: string,
): Promise<{ fileRef: string; thumbRef: string | null; type: AssetType } | null> {
  const db = createDb(env.DB);
  const row = (
    await db
      .select({ fileRef: assets.fileRef, thumbRef: assets.thumbRef, type: assets.type })
      .from(assets)
      .where(and(eq(assets.id, assetId), eq(assets.brandId, brandId)))
      .limit(1)
  ).at(0);
  if (!row) return null;
  return { fileRef: row.fileRef, thumbRef: row.thumbRef, type: asAssetType(row.type) };
}

/**
 * Gated: a short-lived signed URL for an asset the caller's brand owns. The
 * ownership check (`brand_id === activeOrgId`) is the tenancy boundary — a forged
 * `assetId` from another brand resolves to null, never another brand's blob. The
 * disposition is chosen by type (zip downloads; the rest preview inline). Returns
 * `{ url: null }` when roadie is inert (local dev, no R2) or the blob won't
 * resolve, so the viewer degrades to a "preview needs R2" note.
 */
export const getAssetReadUrl = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(assetIdInput)
  .handler(async ({ data, context }): Promise<{ url: string | null; type: AssetType | null }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const asset = await loadOwnedAsset(data.assetId, brandId);
    if (!asset) return { url: null, type: null };

    try {
      const res = await getRoadie().getReadUrl({
        referenceId: asset.fileRef,
        disposition: dispositionFor(asset.type),
        permissionScope: `brand:${brandId}`,
      });
      return { url: res.ok ? res.value.url : null, type: asset.type };
    } catch {
      // roadie inert / failed — viewer falls back to the "preview needs R2" note.
      return { url: null, type: asset.type };
    }
  });

/**
 * Gated: a short-lived inline read URL for an asset's thumbnail (`thumb_ref`),
 * for the library grid's `<img>`. Unlike `getAssetReadUrl` this is a passive
 * thumbnail fetch — it records NO download and emits NO analytics event (looking
 * at a card's thumbnail isn't an `asset_download` signal). The ownership check
 * (`brand_id === activeOrgId`) is the tenancy boundary — a forged `assetId` from
 * another brand resolves to null, never another brand's blob. Returns
 * `{ url: null }` when no thumbnail exists (`thumb_ref` NULL / still a `pending:`
 * placeholder), when roadie is inert (local dev, no R2), or when the blob won't
 * resolve, so the card falls back to the generic FileIcon glyph rather than a
 * broken frame. brand = envelope `activeOrgId`, never input.
 */
export const getAssetThumbUrl = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(assetIdInput)
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const asset = await loadOwnedAsset(data.assetId, brandId);
    // No thumbnail row, or a still-pending placeholder ref → fall back to glyph.
    if (!asset?.thumbRef?.trim() || asset.thumbRef.startsWith("pending:")) {
      return { url: null };
    }

    try {
      const res = await getRoadie().getReadUrl({
        referenceId: asset.thumbRef,
        disposition: "inline",
        permissionScope: `brand:${brandId}`,
      });
      return { url: res.ok ? res.value.url : null };
    } catch {
      // roadie inert / failed — card falls back to the generic FileIcon glyph.
      return { url: null };
    }
  });

/**
 * Gated: bump `assets.download_count` + emit an `asset_download` event in the
 * SAME logical write. Scoped to the caller's brand so a download can never be
 * recorded against another brand's asset (the UPDATE's `brand_id` guard + the
 * pre-check both enforce ownership). A forged/foreign `assetId` is a no-op.
 */
export const recordDownload = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(assetIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const asset = await loadOwnedAsset(data.assetId, brandId);
    if (!asset) return { ok: true }; // not ours / unknown — no-op

    const db = createDb(env.DB);
    await db
      .update(assets)
      .set({ downloadCount: sql`${assets.downloadCount} + 1` })
      .where(and(eq(assets.id, data.assetId), eq(assets.brandId, brandId)));

    await emitEvent({
      brandId,
      actorId: userId,
      type: "asset_download",
      targetType: "asset",
      targetId: data.assetId,
      metadata: { type: asset.type },
    });

    return { ok: true };
  });

// ─── admin mutations (brand-role gated, in-handler decideBrandAdmin) ────────

const registerUploadInput = type({
  name: "string >= 1",
  "category?": "string",
  type: "'pdf' | 'image' | 'video' | 'zip'",
  hash: /^[a-f0-9]{64}$/,
  size: "number >= 0",
  contentType: "string >= 1",
});

export interface RegisterAssetUploadResult {
  assetId: string;
  /** Reference handle to thread back into `finalizeAssetUpload`. */
  referenceId: string;
  /** Presigned PUT envelope for the browser, or null when roadie is inert. */
  upload: { url: string; headers: Record<string, string> } | null;
}

/**
 * Admin: open a draft asset. INSERTs the metadata row (status='draft', a
 * placeholder `file_ref` until finalize) and registers the upload with roadie,
 * returning the presigned PUT envelope for the browser to push the bytes. brand =
 * envelope `activeOrgId`, never input. When roadie is inert (local dev) the row
 * still lands and `upload` is null — the admin sees the draft but can't push
 * bytes until R2 is provisioned.
 */
export const registerAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(registerUploadInput)
  .handler(async ({ data, context }): Promise<RegisterAssetUploadResult> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const assetId = ulid();
    const now = Date.now();
    const category = data.category?.trim() ? data.category.trim() : null;

    // Register with roadie first so the returned referenceId becomes file_ref.
    // The placeholder is overwritten on success; if roadie is inert it stays and
    // finalize will fail gracefully later (the row is still a recoverable draft).
    let referenceId = `pending:${assetId}`;
    let upload: RegisterAssetUploadResult["upload"] = null;
    try {
      const res = await getRoadie().registerUpload({
        hash: data.hash,
        size: data.size,
        contentType: data.contentType,
        application: { app: "sprout", resourceType: "asset", resourceId: assetId },
      });
      if (res.ok) {
        referenceId = res.value.referenceId;
        if (res.value.status === "single-part") {
          upload = {
            url: res.value.upload.uploadUrl,
            headers: res.value.upload.requiredHeaders,
          };
        }
        // "ready" (dedup hit) → no upload needed; "multipart" → out of scope for
        // P1 (assets are small kit), the admin re-tries with a smaller file.
      }
    } catch {
      referenceId = `pending:${assetId}`; // roadie inert — keep the placeholder
      upload = null;
    }

    const db = createDb(env.DB);
    await db.insert(assets).values({
      id: assetId,
      brandId,
      name: data.name,
      category,
      type: data.type,
      fileRef: referenceId,
      sizeBytes: data.size,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit({
      brandId,
      action: "asset.register",
      actorId: userId,
      targetType: "asset",
      targetId: assetId,
      meta: { name: data.name, type: data.type, size: data.size },
    });

    return { assetId, referenceId, upload };
  });

const finalizeUploadInput = type({
  assetId: "string >= 1",
  referenceId: "string >= 1",
});

/**
 * Admin: finalize a draft upload. Tells roadie the bytes are fully pushed, then
 * stamps `file_ref` + `size_bytes` from the finalized blob and flips
 * status='published'. brand = envelope `activeOrgId`. Throws if the asset isn't
 * the caller's brand's. Surfaces a roadie failure (inert / missing parts) as
 * "finalize_failed" so the admin can retry rather than publishing a broken row.
 */
export const finalizeAssetUpload = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(finalizeUploadInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ id: assets.id })
        .from(assets)
        .where(and(eq(assets.id, data.assetId), eq(assets.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!owned) throw new Error("not_found");

    let fileRef = data.referenceId;
    let size = 0;
    try {
      const res = await getRoadie().finalize({ referenceId: data.referenceId });
      if (!res.ok) throw new Error(`finalize_failed:${res.error}`);
      fileRef = res.value.referenceId;
      size = res.value.size;
    } catch (e) {
      throw e instanceof Error ? e : new Error("finalize_failed");
    }

    await db
      .update(assets)
      .set({ fileRef, sizeBytes: size, status: "published", updatedAt: Date.now() })
      .where(and(eq(assets.id, data.assetId), eq(assets.brandId, brandId)));

    await writeAudit({
      brandId,
      action: "asset.finalize",
      actorId: userId,
      targetType: "asset",
      targetId: data.assetId,
      meta: { size },
    });

    return { ok: true };
  });

const upsertMetaInput = type({
  assetId: "string >= 1",
  name: "string >= 1",
  "category?": "string",
  physicalAvailable: "boolean",
  "physicalMaxQty?": "number >= 0",
});

/**
 * Admin: edit an asset's metadata — name, category, and the physical-print flags
 * (`physical_available` + `physical_max_qty`). The physical flags are SET now but
 * INERT until P4.A wires fulfilment. brand = envelope `activeOrgId`; the UPDATE's
 * `brand_id` guard makes a cross-brand edit a silent no-op (then we 404).
 */
export const upsertAssetMeta = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertMetaInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const category = data.category?.trim() ? data.category.trim() : null;
    // Only carry a max-qty when physical availability is on; otherwise null it.
    const maxQty = data.physicalAvailable ? (data.physicalMaxQty ?? null) : null;

    const db = createDb(env.DB);
    const updated = await db
      .update(assets)
      .set({
        name: data.name,
        category,
        physicalAvailable: data.physicalAvailable ? 1 : 0,
        physicalMaxQty: maxQty,
        updatedAt: Date.now(),
      })
      .where(and(eq(assets.id, data.assetId), eq(assets.brandId, brandId)))
      .returning({ id: assets.id });
    if (updated.length === 0) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "asset.meta.upsert",
      actorId: userId,
      targetType: "asset",
      targetId: data.assetId,
      meta: {
        name: data.name,
        category,
        physicalAvailable: data.physicalAvailable,
        physicalMaxQty: maxQty,
      },
    });

    return { ok: true };
  });

/**
 * Admin: archive an asset (soft delete — stamps `archived_at`). It drops out of
 * `listAssets` immediately but its blob + analytics history survive. brand =
 * envelope `activeOrgId`; the UPDATE's `brand_id` guard scopes the write.
 */
export const archiveAsset = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(assetIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const now = Date.now();
    const db = createDb(env.DB);
    const archived = await db
      .update(assets)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(eq(assets.id, data.assetId), eq(assets.brandId, brandId), isNull(assets.archivedAt)),
      )
      .returning({ id: assets.id });
    if (archived.length === 0) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "asset.archive",
      actorId: userId,
      targetType: "asset",
      targetId: data.assetId,
    });

    return { ok: true };
  });

/**
 * Admin: the full library (incl. drafts + archived) for the management table.
 * brand = envelope `activeOrgId`, never input. Brand-role gated so a plain
 * budtender can't enumerate drafts. Ordered newest-first.
 */
export const listAdminAssets = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminAssetView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select(ASSET_COLS)
      .from(assets)
      .where(eq(assets.brandId, brandId))
      .orderBy(desc(assets.createdAt), desc(assets.id));

    return rows.map(mapAdminView);
  });
