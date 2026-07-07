/**
 * PK-Deck server functions (P2.C) — the flip-viewer library + its admin upload
 * surface. A deck is one uploaded PDF (R2 blob via roadie); D1 holds the
 * metadata + the reference handle (`pdf_ref`). `page_count` + `cover_thumb_ref`
 * are derived ASYNC by the `deck.derive` queue job (enqueued by
 * `finalizeDeckUpload`), so a freshly-finalized deck shows page_count=0
 * ("processing") in the library until the job lands.
 *
 * Two tenancy modes, per the §02 invariant (brand_id is NEVER input):
 *
 *  - The budtender reads/flips (`listDecks`, `getDeckReadUrl`, `recordFlipDepth`,
 *    `recordDeckDownload`) gate with `requireUserMiddleware` and scope every row
 *    to the verified envelope's `activeOrgId`. A deck is only served if its
 *    `brand_id === activeOrgId` — a forged `deckId` from another brand resolves
 *    to "not found", never another brand's blob.
 *  - The Brand-Admin mutations (`registerDeckUpload`, `finalizeDeckUpload`,
 *    `upsertDeckMeta`, `archiveDeck`) additionally gate IN-HANDLER on
 *    `decideBrandAdmin({ actorRole, orgRole })`. Every mutation calls `writeAudit`
 *    in the same logical write.
 *
 * Roadie blob I/O needs R2 secrets (inert in local dev), so the upload/finalize/
 * read-url calls are wrapped — a metadata row still lands, and the read paths
 * degrade to a null URL (the viewer shows a "preview needs R2" note rather than a
 * broken frame). The flip-depth + download analytics paths run fully locally.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { deckProgress, decks } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { getRoadie } from "@/lib/roadie";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";

/** A published deck as the budtender library grid renders it. */
export interface DeckView {
  id: string;
  title: string;
  productLine: string | null;
  pageCount: number; // 0 = still processing (page_count not yet derived)
  coverThumbRef: string | null;
  downloadAllowed: boolean;
  publishedAt: number | null;
  createdAt: number;
}

/** The admin-library projection — adds lifecycle fields the budtender never sees. */
export interface AdminDeckView extends DeckView {
  pdfRef: string | null;
  status: string;
  updatedAt: number;
  archivedAt: number | null;
}

// Drizzle returns rows keyed by the schema's camelCase TS field names.
type DeckRow = typeof decks.$inferSelect;

function mapView(row: DeckRow): DeckView {
  return {
    id: row.id,
    title: row.title,
    productLine: row.productLine,
    pageCount: row.pageCount,
    coverThumbRef: row.coverThumbRef,
    downloadAllowed: row.downloadAllowed !== 0,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
  };
}

function mapAdminView(row: DeckRow): AdminDeckView {
  return {
    ...mapView(row),
    pdfRef: row.pdfRef,
    status: row.status,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

// ─── budtender reads (authenticated, envelope-scoped) ───────────────────────

/**
 * Gated: the caller's brand's published, non-archived decks, newest-first. brand
 * = envelope `activeOrgId`, never input. A deck whose `page_count` is still 0 is
 * returned (the library card shows a "processing" placeholder), so an admin sees
 * the deck land before the derive job finishes. No active org → empty list.
 */
export const listDecks = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<DeckView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(decks)
      .where(
        and(eq(decks.brandId, brandId), eq(decks.status, "published"), isNull(decks.archivedAt)),
      )
      .orderBy(desc(decks.publishedAt), desc(decks.createdAt), desc(decks.id));

    return rows.map(mapView);
  });

const deckIdInput = type({ deckId: "string >= 1" });

/** Verify the deck belongs to `brandId` and return the columns the read paths need. */
async function loadOwnedDeck(
  deckId: string,
  brandId: string,
): Promise<{ pdfRef: string | null; downloadAllowed: boolean } | null> {
  const db = createDb(env.DB);
  const row = (
    await db
      .select({ pdfRef: decks.pdfRef, downloadAllowed: decks.downloadAllowed })
      .from(decks)
      .where(and(eq(decks.id, deckId), eq(decks.brandId, brandId)))
      .limit(1)
  ).at(0);
  if (!row) return null;
  return { pdfRef: row.pdfRef, downloadAllowed: row.downloadAllowed !== 0 };
}

/**
 * Gated: a short-lived signed URL (inline) for a deck the caller's brand owns,
 * plus a `deck_open` event in the same call. The ownership check
 * (`brand_id === activeOrgId`) is the tenancy boundary — a forged `deckId` from
 * another brand resolves to null, never another brand's blob. Returns
 * `{ url: null }` when roadie is inert (local dev, no R2), when the deck has no
 * `pdf_ref` yet (pre-finalize), or when the blob won't resolve, so the viewer
 * degrades to a "preview needs R2" note rather than a broken frame.
 */
export const getDeckReadUrl = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(deckIdInput)
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const deck = await loadOwnedDeck(data.deckId, brandId);
    if (!deck) return { url: null };

    // Opening a deck is the engagement signal — emitted even when roadie can't
    // mint a URL (the budtender intended to open it; analytics shouldn't depend
    // on R2 being provisioned).
    await emitEvent({
      brandId,
      actorId: userId,
      type: "deck_open",
      targetType: "deck",
      targetId: data.deckId,
    });

    if (!deck.pdfRef) return { url: null }; // not finalized yet

    try {
      const res = await getRoadie().getReadUrl({
        referenceId: deck.pdfRef,
        disposition: "inline",
        permissionScope: `brand:${brandId}`,
      });
      return { url: res.ok ? res.value.url : null };
    } catch {
      // roadie inert / failed — viewer falls back to the "preview needs R2" note.
      return { url: null };
    }
  });

/**
 * Gated: a short-lived inline read URL for a deck's derived cover thumbnail (the
 * page-1 PNG the `deck.derive` job renders into roadie), for the library grid's
 * `<img>`. Unlike `getDeckReadUrl` this is a passive thumbnail fetch — it emits
 * NO analytics event (opening the cover thumbnail isn't a `deck_open` signal).
 * The ownership check (`brand_id === activeOrgId`) is the tenancy boundary — a
 * forged `deckId` from another brand resolves to null, never another brand's
 * blob. Returns `{ url: null }` when the thumbnail isn't derived yet
 * (`cover_thumb_ref` NULL), when roadie is inert (local dev, no R2), or when the
 * blob won't resolve, so the card falls back to the generic FileIcon glyph
 * rather than a broken frame. brand = envelope `activeOrgId`, never input.
 */
export const getDeckCoverUrl = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(deckIdInput)
  .handler(async ({ data, context }): Promise<{ url: string | null }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const row = (
      await db
        .select({ coverThumbRef: decks.coverThumbRef })
        .from(decks)
        .where(and(eq(decks.id, data.deckId), eq(decks.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!row?.coverThumbRef) return { url: null }; // not derived yet / not ours

    try {
      const res = await getRoadie().getReadUrl({
        referenceId: row.coverThumbRef,
        disposition: "inline",
        permissionScope: `brand:${brandId}`,
      });
      return { url: res.ok ? res.value.url : null };
    } catch {
      // roadie inert / failed — card falls back to the generic FileIcon glyph.
      return { url: null };
    }
  });

const flipDepthInput = type({
  deckId: "string >= 1",
  page: "number >= 1",
  "dwellMs?": "number >= 0",
});

/**
 * Gated: upsert the caller's per-deck flip-depth state + emit a `deck_flip`
 * event. `last_page` advances to max(existing, page) (so going BACK never lowers
 * the recorded depth) and `dwellMs` accrues into `time_spent_seconds`. Scoped to
 * the caller's brand; a forged/foreign `deckId` is a silent no-op. The
 * `deck_progress` row carries the denormalized `brand_id` from the deck.
 */
export const recordFlipDepth = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(flipDepthInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const deck = await loadOwnedDeck(data.deckId, brandId);
    if (!deck) return { ok: true }; // not ours / unknown — no-op

    const now = Date.now();
    const dwellSeconds = Math.round((data.dwellMs ?? 0) / 1000);

    // Upsert keyed on the (deck_id, user_id) unique index. On conflict we lift
    // last_page to the high-water mark and accrue dwell; we never lower either.
    const db = createDb(env.DB);
    await db
      .insert(deckProgress)
      .values({
        id: ulid(),
        brandId,
        deckId: data.deckId,
        userId,
        lastPage: data.page,
        timeSpentSeconds: dwellSeconds,
        openedAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [deckProgress.deckId, deckProgress.userId],
        set: {
          lastPage: sql`MAX(${deckProgress.lastPage}, excluded.last_page)`,
          timeSpentSeconds: sql`${deckProgress.timeSpentSeconds} + ${dwellSeconds}`,
          updatedAt: sql`excluded.updated_at`,
        },
      });

    await emitEvent({
      brandId,
      actorId: userId,
      type: "deck_flip",
      targetType: "deck",
      targetId: data.deckId,
      metadata: { page: data.page, dwellMs: data.dwellMs ?? 0 },
    });

    return { ok: true };
  });

/**
 * Gated: record a deck download — emits a `deck_download` event, but ONLY when
 * the deck's `download_allowed` flag is set (the viewer hides the button
 * otherwise; this is the server-side enforcement). Scoped to the caller's brand;
 * a forged/foreign `deckId` or a download-disabled deck is a silent no-op.
 */
export const recordDeckDownload = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(deckIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true; allowed: boolean }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const deck = await loadOwnedDeck(data.deckId, brandId);
    if (!deck || !deck.downloadAllowed) return { ok: true, allowed: false };

    await emitEvent({
      brandId,
      actorId: userId,
      type: "deck_download",
      targetType: "deck",
      targetId: data.deckId,
    });

    return { ok: true, allowed: true };
  });

// ─── admin mutations (brand-role gated, in-handler decideBrandAdmin) ────────

const registerUploadInput = type({
  title: "string >= 1",
  "productLine?": "string",
  downloadAllowed: "boolean",
  hash: /^[a-f0-9]{64}$/,
  size: "number >= 0",
  contentType: "string >= 1",
});

export interface RegisterDeckUploadResult {
  deckId: string;
  /** Reference handle to thread back into `finalizeDeckUpload`. */
  referenceId: string;
  /** Presigned PUT envelope for the browser, or null when roadie is inert. */
  uploadUrl: { url: string; headers: Record<string, string> } | null;
}

/**
 * Admin: open a draft deck. INSERTs the metadata row (status='draft',
 * `pdf_ref` NULL until finalize) and registers the upload with roadie, returning
 * the presigned PUT envelope for the browser to push the PDF bytes. brand =
 * envelope `activeOrgId`, never input. When roadie is inert (local dev) the row
 * still lands and `uploadUrl` is null — the admin sees the draft but can't push
 * bytes until R2 is provisioned.
 */
export const registerDeckUpload = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(registerUploadInput)
  .handler(async ({ data, context }): Promise<RegisterDeckUploadResult> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const deckId = ulid();
    const now = Date.now();
    const productLine = data.productLine?.trim() ? data.productLine.trim() : null;

    // Register with roadie first so the returned referenceId threads into
    // finalize. If roadie is inert the upload is null and the row stays a
    // recoverable draft (no pdf_ref yet).
    let referenceId = `pending:${deckId}`;
    let uploadUrl: RegisterDeckUploadResult["uploadUrl"] = null;
    try {
      const res = await getRoadie().registerUpload({
        hash: data.hash,
        size: data.size,
        contentType: data.contentType,
        application: { app: "sprout", resourceType: "deck", resourceId: deckId },
      });
      if (res.ok) {
        referenceId = res.value.referenceId;
        if (res.value.status === "single-part") {
          uploadUrl = {
            url: res.value.upload.uploadUrl,
            headers: res.value.upload.requiredHeaders,
          };
        }
        // "ready" (dedup hit) → no upload needed; "multipart" → out of scope here
        // (decks are single PDFs), the admin re-tries with a smaller file.
      }
    } catch {
      referenceId = `pending:${deckId}`; // roadie inert — keep the placeholder
      uploadUrl = null;
    }

    const db = createDb(env.DB);
    await db.insert(decks).values({
      id: deckId,
      brandId,
      title: data.title,
      productLine,
      pdfRef: null,
      pageCount: 0,
      downloadAllowed: data.downloadAllowed ? 1 : 0,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit({
      brandId,
      action: "deck.register",
      actorId: userId,
      targetType: "deck",
      targetId: deckId,
      meta: { title: data.title, size: data.size, downloadAllowed: data.downloadAllowed },
    });

    return { deckId, referenceId, uploadUrl };
  });

const finalizeUploadInput = type({
  deckId: "string >= 1",
  referenceId: "string >= 1",
});

/**
 * Admin: finalize a draft deck. Tells roadie the PDF bytes are fully pushed,
 * stamps `pdf_ref`, flips status='published', stamps `published_at`, and ENQUEUES
 * the `deck.derive` job (unpdf page_count + page-1 thumbnail). `page_count` stays
 * 0 ("processing") until that job lands. brand = envelope `activeOrgId`. Throws
 * if the deck isn't the caller's brand's. Surfaces a roadie failure (inert /
 * missing parts) as "finalize_failed" so the admin can retry.
 */
export const finalizeDeckUpload = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(finalizeUploadInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ id: decks.id })
        .from(decks)
        .where(and(eq(decks.id, data.deckId), eq(decks.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!owned) throw new Error("not_found");

    let pdfRef = data.referenceId;
    try {
      const res = await getRoadie().finalize({ referenceId: data.referenceId });
      if (!res.ok) throw new Error(`finalize_failed:${res.error}`);
      pdfRef = res.value.referenceId;
    } catch (e) {
      throw e instanceof Error ? e : new Error("finalize_failed");
    }

    const now = Date.now();
    await db
      .update(decks)
      .set({ pdfRef, status: "published", publishedAt: now, updatedAt: now })
      .where(and(eq(decks.id, data.deckId), eq(decks.brandId, brandId)));

    // Enqueue the async derive (page_count + page-1 thumbnail). Best-effort — if
    // the queue send throws the deck still publishes (page_count stays 0); a
    // re-finalize or the admin's "reprocess" path would re-enqueue.
    try {
      await env.SPROUT_JOBS_QUEUE.send({
        kind: "deck.derive",
        deckId: data.deckId,
        brandId,
        referenceId: pdfRef,
      });
    } catch (e) {
      console.error("[deck.finalize] enqueue deck.derive failed", { deckId: data.deckId, e });
    }

    await writeAudit({
      brandId,
      action: "deck.finalize",
      actorId: userId,
      targetType: "deck",
      targetId: data.deckId,
      meta: { pdfRef },
    });

    return { ok: true };
  });

const upsertMetaInput = type({
  deckId: "string >= 1",
  title: "string >= 1",
  "productLine?": "string",
  downloadAllowed: "boolean",
});

/**
 * Admin: edit a deck's metadata — title, product line, and the
 * `download_allowed` gate. brand = envelope `activeOrgId`; the UPDATE's
 * `brand_id` guard makes a cross-brand edit a silent no-op (then we 404).
 */
export const upsertDeckMeta = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertMetaInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const productLine = data.productLine?.trim() ? data.productLine.trim() : null;

    const db = createDb(env.DB);
    const res = await db
      .update(decks)
      .set({
        title: data.title,
        productLine,
        downloadAllowed: data.downloadAllowed ? 1 : 0,
        updatedAt: Date.now(),
      })
      .where(and(eq(decks.id, data.deckId), eq(decks.brandId, brandId)));
    if (!res.meta.changes) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "deck.meta.upsert",
      actorId: userId,
      targetType: "deck",
      targetId: data.deckId,
      meta: { title: data.title, productLine, downloadAllowed: data.downloadAllowed },
    });

    return { ok: true };
  });

/**
 * Admin: archive a deck (soft delete — stamps `archived_at`). It drops out of
 * `listDecks` immediately but its blob + flip-depth history survive. brand =
 * envelope `activeOrgId`; the UPDATE's `brand_id` guard scopes the write.
 */
export const archiveDeck = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(deckIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const res = await db
      .update(decks)
      .set({ archivedAt: Date.now(), updatedAt: Date.now() })
      .where(and(eq(decks.id, data.deckId), eq(decks.brandId, brandId), isNull(decks.archivedAt)));
    if (!res.meta.changes) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "deck.archive",
      actorId: userId,
      targetType: "deck",
      targetId: data.deckId,
    });

    return { ok: true };
  });

/**
 * Admin: the full deck library (incl. drafts + archived) for the management
 * table. brand = envelope `activeOrgId`, never input. Brand-role gated so a plain
 * budtender can't enumerate drafts. Ordered newest-first.
 */
export const listAdminDecks = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminDeckView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(decks)
      .where(eq(decks.brandId, brandId))
      .orderBy(desc(decks.createdAt), desc(decks.id));

    return rows.map(mapAdminView);
  });
