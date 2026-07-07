/**
 * Sprout queue consumer (binding SPROUT_JOBS_QUEUE). Dispatches on
 * `SproutJobMessage.kind` with a documented, typed switch. Per-message contract:
 * `ack()` on success, `retry()` on throw (CF redelivers up to the queue's
 * max_retries, then dead-letters). One structured `console.log` per kind keeps
 * the dispatch observable in `wrangler tail` even while every kind is a no-op.
 *
 * `deck.derive` (P2.C) is implemented below: unpdf reads page_count + the corpus
 * text, and — when the Browser Rendering binding is provisioned — a page-1 PNG is
 * screenshotted and `put` to roadie as the cover thumbnail. It is defensive: any
 * step that needs a binding absent in local dev (roadie R2, BROWSER) is skipped
 * with a log rather than throwing, and the whole handler is wrapped so a bad PDF
 * never poison-loops the queue.
 *
 * `embed` (P4.D) is implemented below: it (re)indexes one content row's chunks
 * into Cloudflare Vectorize + the `ai_embeddings` provenance table for the RAG
 * assistant. Like `deck.derive` it is defensive — when `env.AI`/`env.VECTORIZE`
 * are absent in local dev it skips with a log rather than throwing, so the queue
 * never poison-loops on a binding that isn't provisioned yet.
 *
 * Future kinds land in their own phases (the `kind` union in `sprout-env.ts`
 * grows alongside them — keep this switch exhaustive when it does):
 *   - `attempt.completed`  → re-index user_brand_scores inputs + render the
 *                            cert badge for a finished quiz attempt.
 *
 * Param types stay `unknown` to match the kit's structural queue-handler shape;
 * the batch is narrowed to `SproutJobBatch` once inside.
 */
import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { aiCustomQa, aiEmbeddings, assets, decks, products } from "@/schema";
import { getRoadie } from "@/lib/roadie";
import { embed, EMBED_MODEL } from "@/lib/ai";
import type { SproutJobMessage } from "@/sprout-env";
import { sha256Hex } from "@/lib/files";

interface SproutQueueMessage {
  body: SproutJobMessage;
  ack(): void;
  retry(): void;
}

interface SproutJobBatch {
  messages: SproutQueueMessage[];
}

/** Dispatch a single message by kind. Throwing here triggers `retry()`. */
async function dispatch(message: SproutQueueMessage): Promise<void> {
  const body = message.body;
  switch (body.kind) {
    case "noop":
      // Heartbeat / wiring check. Nothing to do; logged then acked by the caller.
      console.log("[queue] noop", { note: body.note });
      break;
    case "deck.derive":
      await handleDeckDerive(body);
      break;
    case "embed":
      await handleEmbed(body);
      break;
    // FUTURE (added with their phases — see module header):
    //   case "attempt.completed": await handleAttemptCompleted(body); break;
    default:
      // Unknown kind: log and let the caller ack (don't hot-loop a poison
      // message through retry/dead-letter for something we'll never handle).
      console.log("[queue] unknown kind", { body });
  }
}

// ─── deck.derive (P2.C) ─────────────────────────────────────────────────────

type DeckDeriveMessage = Extract<SproutJobMessage, { kind: "deck.derive" }>;

/**
 * Derive a finalized deck's `page_count` (+ corpus text, currently logged for a
 * future AI-search index) and — when Browser Rendering is provisioned — a page-1
 * thumbnail. Defensive throughout: the read URL / roadie / BROWSER paths each
 * degrade to a skip+log rather than a throw, and the final D1 UPDATE always runs
 * with whatever was derived (page_count stays 0 if the PDF couldn't be read, so
 * the library keeps showing "processing" rather than a wrong count).
 */
async function handleDeckDerive(body: DeckDeriveMessage): Promise<void> {
  const { deckId, brandId, referenceId } = body;
  console.log("[queue] deck.derive", { deckId, brandId });

  let pageCount = 0;
  let coverThumbRef: string | null = null;

  // 1) Pull the PDF bytes via a roadie read URL. roadie is inert in local dev
  //    (no R2) → no URL → we skip derive entirely (page_count stays 0).
  let pdfBytes: ArrayBuffer | null = null;
  try {
    const read = await getRoadie().getReadUrl({
      referenceId,
      disposition: "inline",
      permissionScope: `brand:${brandId}`,
    });
    if (read.ok) {
      const res = await fetch(read.value.url);
      if (res.ok) pdfBytes = await res.arrayBuffer();
      else console.log("[deck.derive] pdf fetch non-ok; skipping", { deckId, status: res.status });
    } else {
      console.log("[deck.derive] read url unavailable (R2 inert?); skipping", {
        deckId,
        error: read.error,
      });
    }
  } catch (e) {
    console.log("[deck.derive] read url failed; skipping derive", { deckId, e });
  }

  // 2) unpdf: page_count + corpus text. Runs in-Worker (no extra binding).
  if (pdfBytes) {
    try {
      const { getDocumentProxy, extractText } = await import("unpdf");
      const data = new Uint8Array(pdfBytes);
      const doc = await getDocumentProxy(data);
      pageCount = doc.numPages;
      const { text } = await extractText(doc, { mergePages: true });
      console.log("[deck.derive] extracted", { deckId, pageCount, textChars: text.length });
    } catch (e) {
      console.error("[deck.derive] unpdf parse failed", { deckId, e });
    }
  }

  // 3) Browser Rendering page-1 thumbnail. BROWSER is a provisioning prereq
  //    (referenced loosely so we don't require the binding/dep locally) — if
  //    absent or anything fails, skip with a log and leave cover_thumb_ref null.
  const browser = (env as { BROWSER?: unknown }).BROWSER;
  if (pdfBytes && browser) {
    try {
      coverThumbRef = await renderCoverThumb(browser, pdfBytes, deckId);
    } catch (e) {
      console.error("[deck.derive] thumbnail render failed; continuing", { deckId, e });
    }
  } else if (pdfBytes) {
    console.log("[deck.derive] BROWSER binding absent; skipping thumbnail", { deckId });
  }

  // 4) Stamp whatever we derived. Scoped to (deck, brand) so a stale message can
  //    never touch another brand's row. cover_thumb_ref only overwrites when we
  //    actually produced one (COALESCE keeps an earlier render on a retry).
  try {
    const db = createDb(env.DB);
    await db
      .update(decks)
      .set({
        pageCount,
        // COALESCE keeps an earlier render on a retry: cover_thumb_ref only
        // overwrites when we actually produced one this pass.
        coverThumbRef: sql`COALESCE(${coverThumbRef}, ${decks.coverThumbRef})`,
        updatedAt: Date.now(),
      })
      .where(and(eq(decks.id, deckId), eq(decks.brandId, brandId)));
  } catch (e) {
    console.error("[deck.derive] D1 update failed", { deckId, e });
  }
}

/**
 * Screenshot page 1 of a PDF to a PNG via the Browser Rendering binding and `put`
 * it to roadie, returning the new reference id. Kept binding-agnostic: the
 * BROWSER service is loaded dynamically (the `@cloudflare/puppeteer` import is a
 * provisioning prereq, not a hard dep) so this file builds without it locally.
 * The PDF is handed to the headless browser via a data: URL; we snapshot the
 * first rendered page.
 */
async function renderCoverThumb(
  browser: unknown,
  pdfBytes: ArrayBuffer,
  deckId: string,
): Promise<string | null> {
  // Dynamic import so the bundle/types don't hard-require the puppeteer prereq.
  // The specifier is held in a variable so TS module resolution doesn't try to
  // resolve a package that's a provisioning prereq (not an installed dep).
  const puppeteerPkg = "@cloudflare/puppeteer";
  const puppeteer = (await import(/* @vite-ignore */ puppeteerPkg).catch(() => null)) as {
    launch?: (b: unknown) => Promise<BrowserSession>;
  } | null;
  if (!puppeteer?.launch) {
    console.log("[deck.derive] @cloudflare/puppeteer unavailable; skipping thumbnail", { deckId });
    return null;
  }

  let session: BrowserSession | null = null;
  try {
    session = await puppeteer.launch(browser);
    const page = await session.newPage();
    const dataUrl = `data:application/pdf;base64,${arrayBufferToBase64(pdfBytes)}`;
    await page.goto(dataUrl, { waitUntil: "networkidle0" });
    const png = (await page.screenshot({ type: "png", fullPage: false })) as ArrayBuffer;

    const hash = await sha256Hex(png);
    const res = await getRoadie().put({
      hash,
      size: png.byteLength,
      contentType: "image/png",
      application: { app: "sprout", resourceType: "deck-thumb", resourceId: deckId },
      body: png,
    });
    if (!res.ok) {
      console.log("[deck.derive] roadie put failed; thumbnail dropped", {
        deckId,
        error: res.error,
      });
      return null;
    }
    return res.value.referenceId;
  } finally {
    await session?.close().catch(() => {});
  }
}

/** Minimal structural shape of a puppeteer session — only what the thumbnail path touches. */
interface BrowserSession {
  newPage(): Promise<{
    goto(url: string, opts?: { waitUntil?: string }): Promise<unknown>;
    screenshot(opts?: { type?: string; fullPage?: boolean }): Promise<unknown>;
  }>;
  close(): Promise<void>;
}

/** Base64-encode an ArrayBuffer in chunks (avoids blowing the call stack on big PDFs). */
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// ─── embed (P4.D) ───────────────────────────────────────────────────────────

type EmbedMessage = Extract<SproutJobMessage, { kind: "embed" }>;

/** Max chars per chunk before we split — bge-base handles ~512 tokens comfortably. */
const CHUNK_CHARS = 1000;

/**
 * (Re)index one content row into Vectorize + `ai_embeddings`. Pulls the row's
 * authored text (scoped to its brand — a stale message can never touch another
 * brand's row), chunks it, embeds each chunk via the `env.AI` seam, and upserts
 * the vectors with a `brand_id` metadata tag (the retrieval-time tenancy filter).
 * `ai_embeddings` is reconciled (old rows for this source deleted, fresh inserted)
 * so an edit/disable leaves no stale chunks behind.
 *
 * Defensive: if `env.AI` or `env.VECTORIZE` is absent (local dev) it logs + skips
 * without throwing. A row that no longer exists / has no text just clears its old
 * vectors (handles archive + custom-QA disable).
 */
async function handleEmbed(body: EmbedMessage): Promise<void> {
  const { brandId, sourceType, sourceId } = body;
  console.log("[queue] embed", { brandId, sourceType, sourceId });

  const vectorize = (env as { VECTORIZE?: VectorizeIndex }).VECTORIZE;
  if (!vectorize) {
    console.log("[embed] VECTORIZE binding absent; skipping index", { sourceType, sourceId });
    return;
  }

  const db = createDb(env.DB);

  // 1) Clear any prior vectors/rows for this source so an edit/archive/disable
  //    never leaves stale chunks in search. Read the old vectorize ids first.
  const prior = await db
    .select({ vectorizeId: aiEmbeddings.vectorizeId })
    .from(aiEmbeddings)
    .where(
      and(
        eq(aiEmbeddings.brandId, brandId),
        eq(aiEmbeddings.sourceType, sourceType),
        eq(aiEmbeddings.sourceId, sourceId),
      ),
    );
  const priorIds = prior.map((r) => r.vectorizeId);

  // 2) Pull the row's current authored text (empty ⇒ the row is gone/archived/
  //    disabled → we only clear, never re-index).
  const text = await loadEmbedText(brandId, sourceType, sourceId);
  const chunks = text ? chunkText(text) : [];

  // 3) Embed the chunks via the env.AI seam (returns [] when AI is inert → we
  //    still reconcile the deletes below, just don't add new vectors).
  const vectors = chunks.length > 0 ? await embed(chunks) : [];
  if (chunks.length > 0 && vectors.length === 0) {
    console.log("[embed] AI inert or embed failed; clearing stale only", { sourceType, sourceId });
  }

  // 4) Upsert fresh vectors + insert the matching provenance rows.
  const now = Date.now();
  const newRows: Array<{ id: string; vectorizeId: string; chunkIdx: number; content: string }> = [];
  const upserts: VectorizeVector[] = [];
  for (let i = 0; i < vectors.length; i++) {
    const values = vectors[i];
    const content = chunks[i];
    if (!values || !content) continue;
    const vectorizeId = `${brandId}:${sourceType}:${sourceId}:${i}`;
    upserts.push({
      id: vectorizeId,
      values,
      metadata: { brand_id: brandId, source_type: sourceType, source_id: sourceId },
    });
    newRows.push({ id: ulid(), vectorizeId, chunkIdx: i, content });
  }

  try {
    if (priorIds.length > 0) await vectorize.deleteByIds(priorIds);
    if (upserts.length > 0) await vectorize.upsert(upserts);
  } catch (e) {
    console.error("[embed] vectorize mutation failed", { sourceType, sourceId, e });
    throw e instanceof Error ? e : new Error("vectorize_failed");
  }

  // 5) Reconcile ai_embeddings: drop the old provenance rows, insert the new.
  await db
    .delete(aiEmbeddings)
    .where(
      and(
        eq(aiEmbeddings.brandId, brandId),
        eq(aiEmbeddings.sourceType, sourceType),
        eq(aiEmbeddings.sourceId, sourceId),
      ),
    );
  for (const row of newRows) {
    await db.insert(aiEmbeddings).values({
      id: row.id,
      brandId,
      sourceType,
      sourceId,
      chunkIdx: row.chunkIdx,
      content: row.content,
      vectorizeId: row.vectorizeId,
      model: EMBED_MODEL,
      createdAt: now,
    });
  }
  console.log("[embed] indexed", { sourceType, sourceId, chunks: newRows.length });
}

/**
 * Pull the authored, embeddable text for one content row, scoped to its brand.
 * Only metadata-level text is indexed (the brand's OWN authored copy) — deck/asset
 * body bytes aren't extracted into D1, so the searchable corpus is the titles,
 * categories, talking points, and the custom Q&A pair. Returns null when the row
 * is gone / archived / has no usable text (the caller then only clears stale).
 */
async function loadEmbedText(
  brandId: string,
  sourceType: EmbedMessage["sourceType"],
  sourceId: string,
): Promise<string | null> {
  const db = createDb(env.DB);
  if (sourceType === "product") {
    const row = (
      await db
        .select({
          name: products.name,
          category: products.category,
          format: products.format,
          availableNote: products.availableNote,
          terpenesJson: products.terpenesJson,
          effectsJson: products.effectsJson,
          talkingPointsJson: products.talkingPointsJson,
          status: products.status,
          archivedAt: products.archivedAt,
        })
        .from(products)
        .where(and(eq(products.id, sourceId), eq(products.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!row || row.archivedAt != null || row.status !== "published") return null;
    const parts = [
      row.name,
      row.category ?? "",
      row.format ?? "",
      row.availableNote ?? "",
      jsonList(row.terpenesJson),
      jsonList(row.effectsJson),
      jsonList(row.talkingPointsJson),
    ];
    return joinParts(parts);
  }
  if (sourceType === "deck") {
    const row = (
      await db
        .select({
          title: decks.title,
          productLine: decks.productLine,
          status: decks.status,
          archivedAt: decks.archivedAt,
        })
        .from(decks)
        .where(and(eq(decks.id, sourceId), eq(decks.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!row || row.archivedAt != null || row.status !== "published") return null;
    return joinParts([row.title, row.productLine ?? ""]);
  }
  if (sourceType === "asset") {
    const row = (
      await db
        .select({
          name: assets.name,
          category: assets.category,
          status: assets.status,
          archivedAt: assets.archivedAt,
        })
        .from(assets)
        .where(and(eq(assets.id, sourceId), eq(assets.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!row || row.archivedAt != null || row.status !== "published") return null;
    return joinParts([row.name, row.category ?? ""]);
  }
  // custom_qa
  const row = (
    await db
      .select({
        question: aiCustomQa.question,
        answer: aiCustomQa.answer,
        enabled: aiCustomQa.enabled,
      })
      .from(aiCustomQa)
      .where(and(eq(aiCustomQa.id, sourceId), eq(aiCustomQa.brandId, brandId)))
      .limit(1)
  ).at(0);
  if (!row || row.enabled === 0) return null;
  return joinParts([`Q: ${row.question}`, `A: ${row.answer}`]);
}

/** Parse a JSON string[] column into a comma-joined line (drops non-strings). */
function jsonList(json: string | null | undefined): string {
  if (!json) return "";
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return "";
    return raw.filter((s): s is string => typeof s === "string").join(", ");
  } catch {
    return "";
  }
}

/** Join non-empty parts with newlines; trims to a single clean block. */
function joinParts(parts: string[]): string | null {
  const text = parts
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n")
    .trim();
  return text.length > 0 ? text : null;
}

/** Split text into ~CHUNK_CHARS blocks on paragraph/line boundaries (never mid-word). */
function chunkText(text: string): string[] {
  if (text.length <= CHUNK_CHARS) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > CHUNK_CHARS && current.length > 0) {
      chunks.push(current.trim());
      current = "";
    }
    current += (current.length > 0 ? "\n" : "") + line;
  }
  if (current.trim().length > 0) chunks.push(current.trim());
  return chunks;
}

export async function handleQueueBatch(
  _batch: unknown,
  _env: unknown,
  _ctx: unknown,
): Promise<void> {
  const batch = _batch as SproutJobBatch;
  for (const message of batch.messages) {
    try {
      await dispatch(message);
      message.ack();
    } catch (err) {
      console.error("[queue] handler failed", { kind: message.body.kind, err });
      message.retry();
    }
  }
}
