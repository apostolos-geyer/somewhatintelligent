/**
 * PublisherOperator mutation core (RFC-0001 "PublisherOperator RPC", D8/D9.1/D13)
 * for texts and software records (exec-plan 0004 T16). The Operator-bound
 * entrypoint in `../index.ts` is a thin adapter over this class; separating it
 * lets the D1 pool suite drive every mutation against a real local D1 with no
 * ROADIE binding — the writes take D1, the `ENVIRONMENT` string, and a
 * read-only `StoreCatalog` handle (page-publish reference validation) as deps.
 *
 * INV-AUDIT-1: each successful mutation writes exactly one `operator_event` in
 * the SAME D1 batch as the domain rows, keyed by `UNIQUE(idempotency_key,
 * action)`. A replayed idempotency key returns the recorded `response_json`
 * without re-mutating; a concurrent racer whose event insert loses the unique
 * race rolls its whole batch back and returns the winner's response.
 *
 * INV-REL-1: a text publish inserts an immutable `text_release` BEFORE moving
 * `text_entry.active_release_id` (cross-cutting rule 2) and never updates a
 * retained release in place; `UNIQUE(text_id, version)` forbids reusing a
 * version until the release is deleted (T18).
 *
 * INV-SW-1/INV-SW-2: software carries no version anywhere; a draft save never
 * touches `software_publication`, so the public snapshot and its `updated_at`
 * change only on publish.
 *
 * INV-PAGE-1/INV-DOM-1 (pages, exec-plan 0004 T17): a page carries one
 * versioned discriminated-union document per key. Every write validates the
 * document through the frozen `@si/contracts` validators, which reject unknown
 * component/HTML/style/script fields, over-length strings, and wrong-shaped
 * sections. `publishPage` additionally resolves the document's references —
 * `featuredProductId` through the read-only `StoreCatalog` binding (stored as an
 * external id, never copied), `featuredSoftwareId`/`featuredTextId` against
 * Publisher's own published records, and referenced media against `page`-owned
 * `publisher_media` — snapshotting that media into `publisher_release_media` in
 * the SAME batch as the immutable `page_release` (inserted BEFORE the pointer
 * move) and the audit event. Page deletion lands in T18.
 */
import { type SQL, and, asc, count, desc, eq, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";

import { err, ok } from "@si/contracts/result";
import { isValidVersion, validatePageDocument } from "@si/contracts";
import type {
  ConfirmDeletionInput,
  DeletionError,
  DeletionImpact,
  DeletionPlan,
  DomainResult,
  MediaMutationError,
  OperatorCall,
  OperatorMeta,
  PageDocumentByKey,
  PageDraftDTO,
  PageKey,
  PublicMediaRef,
  PublishedSoftwareDTO,
  PublisherMediaDTO,
  SoftwareDraftDTO,
  StoreCatalogEntrypoint,
  TextDraftDTO,
} from "@si/contracts";

import type { PublisherDb } from "../public/reads";
import type { MediaStorage } from "../lib/media-storage";
import * as schema from "../schema";
import { clampLimit, decodeCursor, encodeCursor } from "../public/cursor";

const {
  textEntry,
  textDraft,
  textRelease,
  tag,
  textTag,
  textLink,
  softwareEntry,
  softwareDraft,
  softwarePublication,
  publisherMedia,
  publisherReleaseMedia,
  softwarePublicationMedia,
  pageEntry,
  pageDraft,
  pageRelease,
  operatorEvent,
  operatorDeletionIntent,
  mediaGcOutbox,
} = schema;

type Stmt = BatchItem<"sqlite">;

/** The read-only `StoreCatalog` surface Publisher needs: resolve a foreign
 *  product id at page-publish time (RFC-0001 "Fixed page document contracts"). */
export type PublisherStoreCatalog = Pick<StoreCatalogEntrypoint, "getProductById">;

export interface PublisherOperatorWritesDeps {
  db: PublisherDb;
  /** Cloudflare `ENVIRONMENT` var; gates loopback `http:` software destinations. */
  environment: string;
  /** `StoreCatalog` binding; validates a page's `featuredProductId` on publish. */
  storeCatalog: PublisherStoreCatalog;
}

// Action names recorded on `operator_event.action` and used with the
// idempotency key for replay dedupe.
const ACTIONS = {
  textCreate: "text.create",
  textSave: "text.save",
  textPublish: "text.publish",
  textRetire: "text.retire",
  softwareCreate: "software.create",
  softwareSave: "software.save",
  softwarePublish: "software.publish",
  softwareRetire: "software.retire",
  pageCreate: "page.create",
  pageSave: "page.save",
  pagePublish: "page.publish",
  // Hard-delete plan/confirm pairs (D8). The PLAN action is stamped on the
  // `operator_deletion_intent` row (matched by confirm); the DELETE action is
  // the `operator_event` action + the replay-idempotency key on execution.
  textReleaseDeletePlan: "textRelease.deletePlan",
  textReleaseDelete: "textRelease.delete",
  textDeletePlan: "text.deletePlan",
  textDelete: "text.delete",
  softwareDeletePlan: "software.deletePlan",
  softwareDelete: "software.delete",
  tagDeletePlan: "tag.deletePlan",
  tagDelete: "tag.delete",
  pageReleaseDeletePlan: "pageRelease.deletePlan",
  pageReleaseDelete: "pageRelease.delete",
  pageDeletePlan: "page.deletePlan",
  pageDelete: "page.delete",
  mediaDeletePlan: "media.deletePlan",
  mediaDelete: "media.delete",
} as const;

const ACTION_LABEL_MAX = 40;
const DEFAULT_ACTION_LABEL = "Open system";
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

// Domain media validation ceiling above the private MediaStorage port (RFC-0001
// D10). The 100 MB bound is Roadie's single-part limit (media-storage-roadie.ts);
// the accepted image set mirrors Store's browser-encodable types. Publisher media
// roles are free-form (schema `role` is plain text, no enum) — a non-empty,
// length-capped label rather than a fixed set.
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const ALLOWED_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
]);
const MEDIA_ROLE_MAX = 40;

// A deletion plan's confirmation token is valid for ten minutes (D8).
const DELETION_TTL_MS = 10 * 60 * 1000;

/** 32-byte random confirmation token, hex-encoded (never persisted in clear). */
function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lowercase hex SHA-256 of a UTF-8 string — token hash + impact hash. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Order-independent JSON: object keys sorted recursively so the impact hash is
 *  stable regardless of `deleteCounts`/`retainedCounts` insertion order. */
function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalize);
    if (v !== null && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(v as Record<string, unknown>).sort()) {
        out[key] = normalize((v as Record<string, unknown>)[key]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(normalize(value));
}

/** Deterministic, race-safe tag id derived from its slug (INSERT-OR-IGNORE key). */
function tagId(slug: string): string {
  return `tag:${slug}`;
}

/** Collapse a raw action label to short single-line plain text; default when empty. */
function sanitizeActionLabel(raw: string): string {
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return DEFAULT_ACTION_LABEL;
  return cleaned.slice(0, ACTION_LABEL_MAX).trim();
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

/**
 * Destination is inert authored data — validated for shape only, never fetched.
 * `https:` is always allowed; loopback `http:` only in development.
 */
function isValidDestination(raw: string, environment: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol === "https:") return true;
  return environment === "development" && url.protocol === "http:" && isLoopbackHost(url.hostname);
}

/** Distinct `[[target]]` wikilink slugs from a body (alias/anchor stripped). */
function parseWikilinkTargets(body: string): string[] {
  const targets = new Set<string>();
  for (const match of body.matchAll(WIKILINK_RE)) {
    const rawTarget = match[1] ?? "";
    const target = rawTarget.split("|")[0]!.split("#")[0]!.trim();
    if (target.length > 0) targets.add(target);
  }
  return [...targets];
}

/** Map a `publisher_media` row to its operator DTO; pending rows are filtered upstream. */
function toPublisherMediaDTO(row: schema.PublisherMediaRow): PublisherMediaDTO {
  return {
    id: row.id,
    ownerType: row.ownerType,
    ownerId: row.ownerId,
    role: row.role,
    alt: row.alt,
    position: row.position,
    state: row.state === "failed" ? "failed" : "ready",
    href: row.state === "ready" ? `/media/${row.id}` : null,
    contentType: row.contentType,
    size: row.sizeBytes,
    sha256: row.contentSha256,
    width: row.width,
    height: row.height,
  };
}

interface MediaRefRow {
  mediaId: string;
  role: string;
  alt: string;
  position: number;
  contentType: string;
  width: number | null;
  height: number | null;
}

function toMediaRef(row: MediaRefRow): PublicMediaRef {
  return {
    id: row.mediaId,
    href: `/media/${row.mediaId}`,
    alt: row.alt,
    role: row.role,
    position: row.position,
    contentType: row.contentType,
    width: row.width,
    height: row.height,
  };
}

// The external + internal ids a page document references, gated at publish
// time. All are optional per key and may be null in the document.
interface PageReferences {
  productIds: string[];
  softwareIds: string[];
  textIds: string[];
  mediaIds: string[];
}

/** Collect a page document's foreign/media references for publish-time
 *  resolution. Reads only the declared reference slots per key — never fabricates
 *  or copies referenced data (INV-DOM-1). */
function collectPageReferences(document: PageDocumentByKey[PageKey]): PageReferences {
  const productIds = new Set<string>();
  const softwareIds = new Set<string>();
  const textIds = new Set<string>();
  const mediaIds = new Set<string>();
  if (document.seo.imageMediaId !== null) mediaIds.add(document.seo.imageMediaId);
  switch (document.key) {
    case "home": {
      if (document.heroMediaId !== null) mediaIds.add(document.heroMediaId);
      const { objects, systems, texts } = document.sections;
      if (objects.featuredProductId !== null) productIds.add(objects.featuredProductId);
      if (systems.featuredSoftwareId !== null) softwareIds.add(systems.featuredSoftwareId);
      if (texts.featuredTextId !== null) textIds.add(texts.featuredTextId);
      break;
    }
    case "about": {
      if (document.primaryMediaId !== null) mediaIds.add(document.primaryMediaId);
      if (document.secondaryMediaId !== null) mediaIds.add(document.secondaryMediaId);
      break;
    }
    // shop / writing / software reference only the SEO image handled above.
  }
  return {
    productIds: [...productIds],
    softwareIds: [...softwareIds],
    textIds: [...textIds],
    mediaIds: [...mediaIds],
  };
}

export class PublisherOperatorWrites {
  private readonly db: PublisherDb;
  private readonly environment: string;
  private readonly storeCatalog: PublisherStoreCatalog;

  constructor(deps: PublisherOperatorWritesDeps) {
    this.db = deps.db;
    this.environment = deps.environment;
    this.storeCatalog = deps.storeCatalog;
  }

  // ── texts ──────────────────────────────────────────────────────────────────

  async listTexts(
    call: OperatorCall<{
      state?: "draft" | "published" | "retired" | "all";
      limit?: number;
      cursor?: string;
    }>,
  ): Promise<DomainResult<{ texts: TextDraftDTO[]; nextCursor: string | null }, "invalid_cursor">> {
    const { input } = call;
    const limit = clampLimit(input.limit);
    const conditions: SQL[] = [];
    if (input.state !== undefined && input.state !== "all") {
      conditions.push(eq(textEntry.state, input.state));
    }
    if (input.cursor !== undefined) {
      const after = decodeCursor(input.cursor);
      if (after === null) return err("invalid_cursor");
      const keyset = or(
        lt(textEntry.updatedAt, after.ts),
        and(eq(textEntry.updatedAt, after.ts), lt(textEntry.id, after.id)),
      );
      if (keyset) conditions.push(keyset);
    }

    const rows = await this.db
      .select({
        textId: textEntry.id,
        slug: textEntry.slug,
        state: textEntry.state,
        updatedAt: textEntry.updatedAt,
        revision: textDraft.revision,
        title: textDraft.title,
        deck: textDraft.deck,
        bodyMarkdown: textDraft.bodyMarkdown,
        activeVersion: textRelease.version,
      })
      .from(textEntry)
      .innerJoin(textDraft, eq(textDraft.textId, textEntry.id))
      .leftJoin(textRelease, eq(textRelease.id, textEntry.activeReleaseId))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(textEntry.updatedAt), desc(textEntry.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const tagsByText = await this.loadTagsByText(page.map((r) => r.textId));
    const texts: TextDraftDTO[] = page.map((r) => ({
      textId: r.textId,
      slug: r.slug,
      revision: r.revision,
      title: r.title,
      deck: r.deck,
      bodyMarkdown: r.bodyMarkdown,
      tags: tagsByText.get(r.textId) ?? [],
      activeVersion: r.activeVersion ?? null,
      state: r.state,
      updatedAt: r.updatedAt,
    }));
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last ? encodeCursor({ ts: last.updatedAt, id: last.textId }) : null;
    return ok({ texts, nextCursor });
  }

  async getText(call: OperatorCall<{ textId: string }>): Promise<
    DomainResult<
      {
        draft: TextDraftDTO;
        releases: Array<{ id: string; version: string; publishedAt: number }>;
        media: PublisherMediaDTO[];
      },
      "not_found"
    >
  > {
    const { textId } = call.input;
    const draft = await this.loadTextDraftDTO(textId);
    if (draft === null) return err("not_found");

    const releases = await this.db
      .select({
        id: textRelease.id,
        version: textRelease.version,
        publishedAt: textRelease.publishedAt,
      })
      .from(textRelease)
      .where(eq(textRelease.textId, textId))
      .orderBy(desc(textRelease.publishedAt), desc(textRelease.id));

    const media = await this.loadOwnedMedia("text", textId);
    return ok({ draft, releases, media });
  }

  async createText(
    call: OperatorCall<{ slug: string; title: string }>,
  ): Promise<DomainResult<{ textId: string; revision: 1 }, "slug_taken">> {
    const { input, meta } = call;
    const replay = await this.replayed<{ textId: string; revision: 1 }>(
      ACTIONS.textCreate,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const slug = input.slug.trim();
    if (await this.textSlugExists(slug, null)) return err("slug_taken");

    const now = Date.now();
    const textId = crypto.randomUUID();
    const value = { textId, revision: 1 as const };
    const statements: Stmt[] = [
      this.db.insert(textEntry).values({
        id: textId,
        slug,
        state: "draft",
        createdBySub: meta.actor.sub,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.insert(textDraft).values({
        textId,
        revision: 1,
        title: input.title.trim(),
        updatedBySub: meta.actor.sub,
        updatedAt: now,
      }),
      this.eventStmt({
        action: ACTIONS.textCreate,
        targetType: "text",
        targetId: textId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.textCreate, meta, statements, value);
  }

  async saveTextDraft(
    call: OperatorCall<{
      textId: string;
      expectedRevision: number;
      slug?: string;
      title?: string;
      deck?: string | null;
      bodyMarkdown?: string;
      tags?: string[];
    }>,
  ): Promise<
    DomainResult<
      { revision: number; updatedAt: number },
      "not_found" | "revision_conflict" | "slug_taken"
    >
  > {
    const { input, meta } = call;
    const replay = await this.replayed<{ revision: number; updatedAt: number }>(
      ACTIONS.textSave,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const [current] = await this.db
      .select({ revision: textDraft.revision, bodyMarkdown: textDraft.bodyMarkdown })
      .from(textDraft)
      .where(eq(textDraft.textId, input.textId))
      .limit(1);
    if (!current) return err("not_found");
    if (current.revision !== input.expectedRevision) return err("revision_conflict");

    const newSlug = input.slug?.trim();
    if (newSlug !== undefined && (await this.textSlugExists(newSlug, input.textId))) {
      return err("slug_taken");
    }

    const now = Date.now();
    const newRevision = current.revision + 1;
    const value = { revision: newRevision, updatedAt: now };

    const draftPatch: Partial<typeof textDraft.$inferInsert> = {
      revision: newRevision,
      updatedBySub: meta.actor.sub,
      updatedAt: now,
    };
    if (input.title !== undefined) draftPatch.title = input.title.trim();
    if (input.deck !== undefined) draftPatch.deck = input.deck;
    if (input.bodyMarkdown !== undefined) draftPatch.bodyMarkdown = input.bodyMarkdown;

    const entryPatch: { updatedAt: number; slug?: string } = { updatedAt: now };
    if (newSlug !== undefined) entryPatch.slug = newSlug;

    const statements: Stmt[] = [
      this.db.update(textDraft).set(draftPatch).where(eq(textDraft.textId, input.textId)),
      this.db.update(textEntry).set(entryPatch).where(eq(textEntry.id, input.textId)),
    ];

    // Tags + wikilinks update atomically in the same batch as the draft save.
    if (input.tags !== undefined) {
      statements.push(...this.tagStatements(input.textId, input.tags, now));
    }
    if (input.bodyMarkdown !== undefined) {
      statements.push(...(await this.wikilinkStatements(input.textId, input.bodyMarkdown, now)));
    }

    statements.push(
      this.eventStmt({
        action: ACTIONS.textSave,
        targetType: "text",
        targetId: input.textId,
        meta,
        value,
        now,
      }),
    );
    return this.commit(ACTIONS.textSave, meta, statements, value);
  }

  async publishText(
    call: OperatorCall<{ textId: string; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      "not_found" | "revision_conflict" | "invalid_version" | "version_exists"
    >
  > {
    const { input, meta } = call;
    const replay = await this.replayed<{
      releaseId: string;
      version: string;
      publishedAt: number;
    }>(ACTIONS.textPublish, meta.idempotencyKey);
    if (replay !== null) return ok(replay);

    if (!isValidVersion(input.version)) return err("invalid_version");

    const [current] = await this.db
      .select({
        slug: textEntry.slug,
        revision: textDraft.revision,
        title: textDraft.title,
        deck: textDraft.deck,
        bodyMarkdown: textDraft.bodyMarkdown,
      })
      .from(textEntry)
      .innerJoin(textDraft, eq(textDraft.textId, textEntry.id))
      .where(eq(textEntry.id, input.textId))
      .limit(1);
    if (!current) return err("not_found");
    if (current.revision !== input.expectedRevision) return err("revision_conflict");

    const [existing] = await this.db
      .select({ id: textRelease.id })
      .from(textRelease)
      .where(and(eq(textRelease.textId, input.textId), eq(textRelease.version, input.version)))
      .limit(1);
    if (existing) return err("version_exists");

    const tags = await this.loadTags(input.textId);
    const readyMedia = await this.loadReadyMedia("text", input.textId);

    const now = Date.now();
    const releaseId = crypto.randomUUID();
    const value = { releaseId, version: input.version, publishedAt: now };

    // Cross-cutting rule 2: release insert + media snapshot BEFORE the pointer
    // move, event in the SAME batch.
    const statements: Stmt[] = [
      this.db.insert(textRelease).values({
        id: releaseId,
        textId: input.textId,
        version: input.version,
        slug: current.slug,
        title: current.title,
        deck: current.deck,
        bodyMarkdown: current.bodyMarkdown,
        tagsJson: JSON.stringify(tags),
        publishedBySub: meta.actor.sub,
        publishedAt: now,
      }),
      ...readyMedia.map((m) =>
        this.db.insert(publisherReleaseMedia).values({
          ownerType: "text",
          releaseId,
          mediaId: m.id,
          role: m.role,
          alt: m.alt,
          position: m.position,
        }),
      ),
      this.db
        .update(textEntry)
        .set({ activeReleaseId: releaseId, state: "published", updatedAt: now })
        .where(eq(textEntry.id, input.textId)),
      this.eventStmt({
        action: ACTIONS.textPublish,
        targetType: "text",
        targetId: input.textId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.textPublish, meta, statements, value);
  }

  async retireText(
    call: OperatorCall<{ textId: string }>,
  ): Promise<DomainResult<{ state: "retired" }, "not_found">> {
    const { input, meta } = call;
    const replay = await this.replayed<{ state: "retired" }>(
      ACTIONS.textRetire,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    if (!(await this.textExists(input.textId))) return err("not_found");

    const now = Date.now();
    const value = { state: "retired" as const };
    const statements: Stmt[] = [
      this.db
        .update(textEntry)
        .set({ state: "retired", retiredAt: now, updatedAt: now })
        .where(eq(textEntry.id, input.textId)),
      this.eventStmt({
        action: ACTIONS.textRetire,
        targetType: "text",
        targetId: input.textId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.textRetire, meta, statements, value);
  }

  // ── software ────────────────────────────────────────────────────────────────

  async listSoftware(
    call: OperatorCall<{
      state?: "draft" | "published" | "retired" | "all";
      limit?: number;
      cursor?: string;
    }>,
  ): Promise<
    DomainResult<{ software: SoftwareDraftDTO[]; nextCursor: string | null }, "invalid_cursor">
  > {
    const { input } = call;
    const limit = clampLimit(input.limit);
    const conditions: SQL[] = [];
    if (input.state !== undefined && input.state !== "all") {
      conditions.push(eq(softwareEntry.state, input.state));
    }
    if (input.cursor !== undefined) {
      const after = decodeCursor(input.cursor);
      if (after === null) return err("invalid_cursor");
      const keyset = or(
        lt(softwareEntry.updatedAt, after.ts),
        and(eq(softwareEntry.updatedAt, after.ts), lt(softwareEntry.id, after.id)),
      );
      if (keyset) conditions.push(keyset);
    }

    const rows = await this.db
      .select({
        softwareId: softwareEntry.id,
        slug: softwareEntry.slug,
        state: softwareEntry.state,
        updatedAt: softwareEntry.updatedAt,
        revision: softwareDraft.revision,
        title: softwareDraft.title,
        deck: softwareDraft.deck,
        whatItIsMarkdown: softwareDraft.whatItIsMarkdown,
        destinationUrl: softwareDraft.destinationUrl,
        actionLabel: softwareDraft.actionLabel,
        primaryMediaId: softwareDraft.primaryMediaId,
        publishedUpdatedAt: softwarePublication.updatedAt,
      })
      .from(softwareEntry)
      .innerJoin(softwareDraft, eq(softwareDraft.softwareId, softwareEntry.id))
      .leftJoin(softwarePublication, eq(softwarePublication.softwareId, softwareEntry.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(softwareEntry.updatedAt), desc(softwareEntry.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const software: SoftwareDraftDTO[] = page.map((r) => ({
      softwareId: r.softwareId,
      slug: r.slug,
      revision: r.revision,
      title: r.title,
      deck: r.deck,
      whatItIsMarkdown: r.whatItIsMarkdown,
      destinationUrl: r.destinationUrl,
      actionLabel: r.actionLabel,
      primaryMediaId: r.primaryMediaId,
      state: r.state,
      publishedUpdatedAt: r.publishedUpdatedAt ?? null,
      updatedAt: r.updatedAt,
    }));
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ ts: last.updatedAt, id: last.softwareId })
        : null;
    return ok({ software, nextCursor });
  }

  async getSoftware(call: OperatorCall<{ softwareId: string }>): Promise<
    DomainResult<
      {
        draft: SoftwareDraftDTO;
        published: PublishedSoftwareDTO | null;
        media: PublisherMediaDTO[];
      },
      "not_found"
    >
  > {
    const { softwareId } = call.input;
    const draft = await this.loadSoftwareDraftDTO(softwareId);
    if (draft === null) return err("not_found");

    const published = await this.loadPublishedSoftware(softwareId);
    const media = await this.loadOwnedMedia("software", softwareId);
    return ok({ draft, published, media });
  }

  async createSoftware(
    call: OperatorCall<{ slug: string; title: string }>,
  ): Promise<DomainResult<{ softwareId: string; revision: 1 }, "slug_taken">> {
    const { input, meta } = call;
    const replay = await this.replayed<{ softwareId: string; revision: 1 }>(
      ACTIONS.softwareCreate,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const slug = input.slug.trim();
    if (await this.softwareSlugExists(slug, null)) return err("slug_taken");

    const now = Date.now();
    const softwareId = crypto.randomUUID();
    const value = { softwareId, revision: 1 as const };
    const statements: Stmt[] = [
      this.db.insert(softwareEntry).values({
        id: softwareId,
        slug,
        state: "draft",
        createdBySub: meta.actor.sub,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.insert(softwareDraft).values({
        softwareId,
        revision: 1,
        title: input.title.trim(),
        updatedBySub: meta.actor.sub,
        updatedAt: now,
      }),
      this.eventStmt({
        action: ACTIONS.softwareCreate,
        targetType: "software",
        targetId: softwareId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.softwareCreate, meta, statements, value);
  }

  async saveSoftwareDraft(
    call: OperatorCall<{
      softwareId: string;
      expectedRevision: number;
      slug?: string;
      title?: string;
      deck?: string;
      whatItIsMarkdown?: string;
      destinationUrl?: string;
      actionLabel?: string;
      primaryMediaId?: string | null;
    }>,
  ): Promise<
    DomainResult<
      { revision: number; updatedAt: number },
      "not_found" | "revision_conflict" | "slug_taken" | "invalid_destination" | "invalid_media"
    >
  > {
    const { input, meta } = call;
    const replay = await this.replayed<{ revision: number; updatedAt: number }>(
      ACTIONS.softwareSave,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const [current] = await this.db
      .select({ revision: softwareDraft.revision })
      .from(softwareDraft)
      .where(eq(softwareDraft.softwareId, input.softwareId))
      .limit(1);
    if (!current) return err("not_found");
    if (current.revision !== input.expectedRevision) return err("revision_conflict");

    const newSlug = input.slug?.trim();
    if (newSlug !== undefined && (await this.softwareSlugExists(newSlug, input.softwareId))) {
      return err("slug_taken");
    }
    // A non-empty destination is validated at draft time; an empty draft is
    // allowed and rejected only at publish.
    if (
      input.destinationUrl !== undefined &&
      input.destinationUrl.length > 0 &&
      !isValidDestination(input.destinationUrl, this.environment)
    ) {
      return err("invalid_destination");
    }
    if (
      input.primaryMediaId !== undefined &&
      input.primaryMediaId !== null &&
      !(await this.mediaOwnedBy(input.primaryMediaId, "software", input.softwareId))
    ) {
      return err("invalid_media");
    }

    const now = Date.now();
    const newRevision = current.revision + 1;
    const value = { revision: newRevision, updatedAt: now };

    const draftPatch: Partial<typeof softwareDraft.$inferInsert> = {
      revision: newRevision,
      updatedBySub: meta.actor.sub,
      updatedAt: now,
    };
    if (input.title !== undefined) draftPatch.title = input.title.trim();
    if (input.deck !== undefined) draftPatch.deck = input.deck;
    if (input.whatItIsMarkdown !== undefined) draftPatch.whatItIsMarkdown = input.whatItIsMarkdown;
    if (input.destinationUrl !== undefined) draftPatch.destinationUrl = input.destinationUrl;
    if (input.actionLabel !== undefined)
      draftPatch.actionLabel = sanitizeActionLabel(input.actionLabel);
    if (input.primaryMediaId !== undefined) draftPatch.primaryMediaId = input.primaryMediaId;

    const entryPatch: { updatedAt: number; slug?: string } = { updatedAt: now };
    if (newSlug !== undefined) entryPatch.slug = newSlug;

    const statements: Stmt[] = [
      this.db
        .update(softwareDraft)
        .set(draftPatch)
        .where(eq(softwareDraft.softwareId, input.softwareId)),
      this.db.update(softwareEntry).set(entryPatch).where(eq(softwareEntry.id, input.softwareId)),
      this.eventStmt({
        action: ACTIONS.softwareSave,
        targetType: "software",
        targetId: input.softwareId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.softwareSave, meta, statements, value);
  }

  async publishSoftware(
    call: OperatorCall<{ softwareId: string; expectedRevision: number }>,
  ): Promise<
    DomainResult<
      { publishedAt: number; updatedAt: number },
      "not_found" | "revision_conflict" | "invalid_destination" | "missing_media"
    >
  > {
    const { input, meta } = call;
    const replay = await this.replayed<{ publishedAt: number; updatedAt: number }>(
      ACTIONS.softwarePublish,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const [current] = await this.db
      .select({
        revision: softwareDraft.revision,
        slug: softwareEntry.slug,
        title: softwareDraft.title,
        deck: softwareDraft.deck,
        whatItIsMarkdown: softwareDraft.whatItIsMarkdown,
        destinationUrl: softwareDraft.destinationUrl,
        actionLabel: softwareDraft.actionLabel,
        primaryMediaId: softwareDraft.primaryMediaId,
      })
      .from(softwareEntry)
      .innerJoin(softwareDraft, eq(softwareDraft.softwareId, softwareEntry.id))
      .where(eq(softwareEntry.id, input.softwareId))
      .limit(1);
    if (!current) return err("not_found");
    if (current.revision !== input.expectedRevision) return err("revision_conflict");
    if (!isValidDestination(current.destinationUrl, this.environment)) {
      return err("invalid_destination");
    }

    const readyMedia = await this.loadReadyMedia("software", input.softwareId);
    // A designated primary image must be among the ready media it snapshots.
    if (
      current.primaryMediaId !== null &&
      !readyMedia.some((m) => m.id === current.primaryMediaId)
    ) {
      return err("missing_media");
    }

    const [existingPublication] = await this.db
      .select({ publishedAt: softwarePublication.publishedAt })
      .from(softwarePublication)
      .where(eq(softwarePublication.softwareId, input.softwareId))
      .limit(1);

    const now = Date.now();
    // First publish sets published_at; every publish sets updated_at (D9.1).
    const publishedAt = existingPublication?.publishedAt ?? now;
    const value = { publishedAt, updatedAt: now };

    const statements: Stmt[] = [
      // Upsert the single snapshot; publish never mutates published_at after first.
      this.db
        .insert(softwarePublication)
        .values({
          softwareId: input.softwareId,
          slug: current.slug,
          title: current.title,
          deck: current.deck,
          whatItIsMarkdown: current.whatItIsMarkdown,
          destinationUrl: current.destinationUrl,
          actionLabel: current.actionLabel,
          primaryMediaId: current.primaryMediaId,
          publishedBySub: meta.actor.sub,
          publishedAt,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: softwarePublication.softwareId,
          set: {
            slug: current.slug,
            title: current.title,
            deck: current.deck,
            whatItIsMarkdown: current.whatItIsMarkdown,
            destinationUrl: current.destinationUrl,
            actionLabel: current.actionLabel,
            primaryMediaId: current.primaryMediaId,
            publishedBySub: meta.actor.sub,
            updatedAt: now,
          },
        }),
      // Replace the publication media snapshot with the current ready set.
      this.db
        .delete(softwarePublicationMedia)
        .where(eq(softwarePublicationMedia.softwareId, input.softwareId)),
      ...readyMedia.map((m) =>
        this.db.insert(softwarePublicationMedia).values({
          softwareId: input.softwareId,
          mediaId: m.id,
          role: m.role,
          alt: m.alt,
          position: m.position,
        }),
      ),
      this.db
        .update(softwareEntry)
        .set({ state: "published", updatedAt: now })
        .where(eq(softwareEntry.id, input.softwareId)),
      this.eventStmt({
        action: ACTIONS.softwarePublish,
        targetType: "software",
        targetId: input.softwareId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.softwarePublish, meta, statements, value);
  }

  async retireSoftware(
    call: OperatorCall<{ softwareId: string }>,
  ): Promise<DomainResult<{ state: "retired" }, "not_found">> {
    const { input, meta } = call;
    const replay = await this.replayed<{ state: "retired" }>(
      ACTIONS.softwareRetire,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    if (!(await this.softwareExists(input.softwareId))) return err("not_found");

    const now = Date.now();
    const value = { state: "retired" as const };
    const statements: Stmt[] = [
      this.db
        .update(softwareEntry)
        .set({ state: "retired", retiredAt: now, updatedAt: now })
        .where(eq(softwareEntry.id, input.softwareId)),
      this.eventStmt({
        action: ACTIONS.softwareRetire,
        targetType: "software",
        targetId: input.softwareId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.softwareRetire, meta, statements, value);
  }

  // ── pages ────────────────────────────────────────────────────────────────────

  async getPage<K extends PageKey>(
    call: OperatorCall<{ key: K }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "not_found">> {
    const { key } = call.input;
    const [row] = await this.db
      .select({
        pageId: pageEntry.id,
        revision: pageDraft.revision,
        documentJson: pageDraft.documentJson,
        updatedAt: pageDraft.updatedAt,
        activeVersion: pageRelease.version,
      })
      .from(pageEntry)
      .innerJoin(pageDraft, eq(pageDraft.pageId, pageEntry.id))
      .leftJoin(pageRelease, eq(pageRelease.id, pageEntry.activeReleaseId))
      .where(eq(pageEntry.pageKey, key))
      .limit(1);
    if (!row) return err("not_found");

    // INV-PAGE-1: validate at the read boundary; a tampered draft is treated as
    // absent, never surfaced as an invalid document.
    const document = this.parsePageDocument(key, row.documentJson);
    if (document === null) return err("not_found");
    return ok({
      pageId: row.pageId,
      key,
      revision: row.revision,
      document,
      activeVersion: row.activeVersion ?? null,
      updatedAt: row.updatedAt,
    });
  }

  async createPage<K extends PageKey>(
    call: OperatorCall<{ key: K; document: PageDocumentByKey[K] }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "page_exists" | "invalid_document">> {
    const { input, meta } = call;
    const replay = await this.replayed<PageDraftDTO<K>>(ACTIONS.pageCreate, meta.idempotencyKey);
    if (replay !== null) return ok(replay);

    const validated = validatePageDocument(input.key, input.document);
    if (!validated.ok) return err("invalid_document", validated.message);

    if (await this.pageExists(input.key)) return err("page_exists");

    const now = Date.now();
    const pageId = crypto.randomUUID();
    const documentJson = JSON.stringify(validated.value);
    const value: PageDraftDTO<K> = {
      pageId,
      key: input.key,
      revision: 1,
      document: validated.value,
      activeVersion: null,
      updatedAt: now,
    };
    const statements: Stmt[] = [
      this.db.insert(pageEntry).values({
        id: pageId,
        pageKey: input.key,
        createdAt: now,
        updatedAt: now,
      }),
      this.db.insert(pageDraft).values({
        pageId,
        revision: 1,
        schemaVersion: validated.value.schemaVersion,
        documentJson,
        updatedBySub: meta.actor.sub,
        updatedAt: now,
      }),
      this.eventStmt({
        action: ACTIONS.pageCreate,
        targetType: "page",
        targetId: pageId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.pageCreate, meta, statements, value);
  }

  async savePageDraft<K extends PageKey>(
    call: OperatorCall<{ key: K; expectedRevision: number; document: PageDocumentByKey[K] }>,
  ): Promise<
    DomainResult<
      { revision: number; updatedAt: number },
      "not_found" | "revision_conflict" | "invalid_document"
    >
  > {
    const { input, meta } = call;
    const replay = await this.replayed<{ revision: number; updatedAt: number }>(
      ACTIONS.pageSave,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const validated = validatePageDocument(input.key, input.document);
    if (!validated.ok) return err("invalid_document", validated.message);

    const [current] = await this.db
      .select({ pageId: pageEntry.id, revision: pageDraft.revision })
      .from(pageEntry)
      .innerJoin(pageDraft, eq(pageDraft.pageId, pageEntry.id))
      .where(eq(pageEntry.pageKey, input.key))
      .limit(1);
    if (!current) return err("not_found");
    if (current.revision !== input.expectedRevision) return err("revision_conflict");

    const now = Date.now();
    const newRevision = current.revision + 1;
    const documentJson = JSON.stringify(validated.value);
    const value = { revision: newRevision, updatedAt: now };
    const statements: Stmt[] = [
      this.db
        .update(pageDraft)
        .set({
          revision: newRevision,
          schemaVersion: validated.value.schemaVersion,
          documentJson,
          updatedBySub: meta.actor.sub,
          updatedAt: now,
        })
        .where(eq(pageDraft.pageId, current.pageId)),
      this.db.update(pageEntry).set({ updatedAt: now }).where(eq(pageEntry.id, current.pageId)),
      this.eventStmt({
        action: ACTIONS.pageSave,
        targetType: "page",
        targetId: current.pageId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.pageSave, meta, statements, value);
  }

  async publishPage(
    call: OperatorCall<{ key: PageKey; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      "not_found" | "revision_conflict" | "invalid_version" | "version_exists" | "invalid_reference"
    >
  > {
    const { input, meta } = call;
    const replay = await this.replayed<{
      releaseId: string;
      version: string;
      publishedAt: number;
    }>(ACTIONS.pagePublish, meta.idempotencyKey);
    if (replay !== null) return ok(replay);

    if (!isValidVersion(input.version)) return err("invalid_version");

    const [current] = await this.db
      .select({
        pageId: pageEntry.id,
        revision: pageDraft.revision,
        schemaVersion: pageDraft.schemaVersion,
        documentJson: pageDraft.documentJson,
      })
      .from(pageEntry)
      .innerJoin(pageDraft, eq(pageDraft.pageId, pageEntry.id))
      .where(eq(pageEntry.pageKey, input.key))
      .limit(1);
    if (!current) return err("not_found");
    if (current.revision !== input.expectedRevision) return err("revision_conflict");

    const [existing] = await this.db
      .select({ id: pageRelease.id })
      .from(pageRelease)
      .where(and(eq(pageRelease.pageId, current.pageId), eq(pageRelease.version, input.version)))
      .limit(1);
    if (existing) return err("version_exists");

    // Re-validate the stored draft (INV-PAGE-1) and resolve every reference it
    // declares (INV-DOM-1) before writing the release. A structurally invalid
    // stored draft is unpublishable; saves gate validity, so that branch is
    // defensive.
    const document = this.parsePageDocument(input.key, current.documentJson);
    if (document === null) return err("invalid_reference");

    const refs = collectPageReferences(document);
    // featuredProductId resolves through the REAL StoreCatalog binding; the id is
    // an external reference, never expanded into the document (INV-DOM-1).
    for (const productId of refs.productIds) {
      const res = await this.storeCatalog.getProductById({ productId });
      if (!res.ok) return err("invalid_reference");
    }
    if (refs.softwareIds.length > 0) {
      const published = await this.publishedSoftwareIds(refs.softwareIds);
      if (refs.softwareIds.some((id) => !published.has(id))) return err("invalid_reference");
    }
    if (refs.textIds.length > 0) {
      const published = await this.publishedTextIds(refs.textIds);
      if (refs.textIds.some((id) => !published.has(id))) return err("invalid_reference");
    }
    // Referenced media must be page-owned; the owned rows are snapshotted so the
    // published page's images become eligible through the release-media join.
    const ownedMedia = await this.pageOwnedMedia(current.pageId, refs.mediaIds);
    if (ownedMedia.length !== refs.mediaIds.length) return err("invalid_reference");

    const now = Date.now();
    const releaseId = crypto.randomUUID();
    const value = { releaseId, version: input.version, publishedAt: now };

    // Cross-cutting rule 2: the immutable release + its media snapshot are
    // written BEFORE the pointer move, with the audit event in the SAME batch.
    const statements: Stmt[] = [
      this.db.insert(pageRelease).values({
        id: releaseId,
        pageId: current.pageId,
        version: input.version,
        schemaVersion: current.schemaVersion,
        documentJson: current.documentJson,
        publishedBySub: meta.actor.sub,
        publishedAt: now,
      }),
      ...ownedMedia.map((m) =>
        this.db.insert(publisherReleaseMedia).values({
          ownerType: "page" as const,
          releaseId,
          mediaId: m.id,
          role: m.role,
          alt: m.alt,
          position: m.position,
        }),
      ),
      this.db
        .update(pageEntry)
        .set({ activeReleaseId: releaseId, updatedAt: now })
        .where(eq(pageEntry.id, current.pageId)),
      this.eventStmt({
        action: ACTIONS.pagePublish,
        targetType: "page",
        targetId: current.pageId,
        meta,
        value,
        now,
      }),
    ];
    return this.commit(ACTIONS.pagePublish, meta, statements, value);
  }

  // ── media ingest (RFC-0001 D10 / T19) ────────────────────────────────────────

  // Operator-only private media ingest. NOT on the frozen
  // `PublisherOperatorEntrypoint` contract: the storage lifecycle is not an RPC
  // method on the documented surface (INV-MEDIA-1). Operator streams the file
  // over the service binding; Publisher validates it, writes the bytes through
  // the injected `MediaStorage` port, and inserts the ready `publisher_media`
  // row — no register/finalize/signed-URL/storage-key vocabulary crosses the
  // boundary. Mirroring Store's ingest, this writes NO `operator_event`: the
  // storage lifecycle is not an audited domain mutation, so there is no
  // idempotency-keyed dedupe here. The private `storage_key` is never returned.
  async ingestMedia(
    input: {
      ownerType: "text" | "software" | "page";
      ownerId: string;
      body: ReadableStream<Uint8Array>;
      contentType: string;
      size: number;
      sha256: string;
      alt: string;
      role: string;
      createdBySub: string;
    },
    media: MediaStorage,
  ): Promise<DomainResult<PublisherMediaDTO, MediaMutationError>> {
    const role = input.role.trim();
    if (role.length === 0 || role.length > MEDIA_ROLE_MAX) return err("invalid_role");
    if (!ALLOWED_MEDIA_TYPES.has(input.contentType)) return err("unsupported_type");
    if (!Number.isInteger(input.size) || input.size <= 0 || input.size > MAX_MEDIA_BYTES) {
      return err("invalid_size");
    }

    // Resolve the owner to the internal id stored on the media row. For pages the
    // caller passes the PageKey; media is owned by the page's internal id.
    const ownerId = await this.resolveMediaOwner(input.ownerType, input.ownerId);
    if (ownerId === null) return err("not_found");

    // Mint the domain media id and hand it to the port as `key`; the port returns
    // the private storage_key we persist (never a DTO field, INV-MEDIA-1).
    const mediaId = crypto.randomUUID();
    const put = await media.put({
      key: mediaId,
      body: input.body,
      contentType: input.contentType,
      size: input.size,
      sha256: input.sha256,
    });
    if (!put.ok) return err("storage_unavailable");

    const position = await this.nextMediaPosition(input.ownerType, ownerId);
    const now = Date.now();
    const row: schema.PublisherMediaRow = {
      id: mediaId,
      ownerType: input.ownerType,
      ownerId,
      storageKey: put.value.key,
      contentSha256: input.sha256,
      contentType: input.contentType,
      sizeBytes: input.size,
      width: null,
      height: null,
      role,
      alt: input.alt,
      position,
      state: "ready",
      createdBySub: input.createdBySub,
      createdAt: now,
      readyAt: now,
    };
    await this.db.insert(publisherMedia).values(row);
    return ok(toPublisherMediaDTO(row));
  }

  // ── batch commit + audit ─────────────────────────────────────────────────────

  // Look up a recorded success for this (action, idempotency key); the parsed
  // response_json is returned verbatim on replay (INV-AUDIT-1).
  private async replayed<V>(action: string, idempotencyKey: string): Promise<V | null> {
    const [row] = await this.db
      .select({ responseJson: operatorEvent.responseJson })
      .from(operatorEvent)
      .where(
        and(eq(operatorEvent.idempotencyKey, idempotencyKey), eq(operatorEvent.action, action)),
      )
      .limit(1);
    if (!row || row.responseJson === null) return null;
    return JSON.parse(row.responseJson) as V;
  }

  // Run the batch (release/domain rows + event) atomically. If the event's
  // UNIQUE(idempotency_key, action) loses a concurrent race the whole batch
  // rolls back; re-read the winner's recorded response instead of erroring.
  private async commit<V>(
    action: string,
    meta: OperatorMeta,
    statements: Stmt[],
    value: V,
  ): Promise<{ ok: true; value: V }> {
    const [first, ...rest] = statements;
    if (!first) throw new Error("publisher: empty operator batch");
    try {
      await this.db.batch([first, ...rest]);
    } catch (error) {
      const prior = await this.replayed<V>(action, meta.idempotencyKey);
      if (prior !== null) return ok(prior);
      throw error;
    }
    return ok(value);
  }

  private eventStmt(p: {
    action: string;
    targetType: string;
    targetId: string;
    meta: OperatorMeta;
    value: unknown;
    now: number;
    // Compact tombstone payload for deletions — identifiers + counts ONLY, never
    // bodies or blobs (D8). Omitted (null) for ordinary mutations.
    detail?: unknown;
  }): Stmt {
    return this.db.insert(operatorEvent).values({
      id: crypto.randomUUID(),
      operatorSub: p.meta.actor.sub,
      operatorEmail: p.meta.actor.email,
      action: p.action,
      targetType: p.targetType,
      targetId: p.targetId,
      requestId: p.meta.requestId,
      idempotencyKey: p.meta.idempotencyKey,
      outcome: "success",
      detailJson: p.detail === undefined ? null : JSON.stringify(p.detail),
      responseJson: JSON.stringify(p.value),
      createdAt: p.now,
    });
  }

  // The compact count-only tombstone detail for a deletion event.
  private tombstone(impact: DeletionImpact): {
    deleteCounts: Record<string, number>;
    retainedCounts: Record<string, number>;
  } {
    return { deleteCounts: impact.deleteCounts, retainedCounts: impact.retainedCounts };
  }

  // ── tags + wikilinks ─────────────────────────────────────────────────────────

  // Statements replacing a text's tag links; deterministic tag ids make the
  // INSERT-OR-IGNORE race-safe.
  private tagStatements(textId: string, tags: string[], now: number): Stmt[] {
    const unique = [...new Set(tags.map((t) => t.trim()).filter((t) => t.length > 0))];
    const statements: Stmt[] = [];
    for (const slug of unique) {
      statements.push(
        this.db
          .insert(tag)
          .values({ id: tagId(slug), slug, label: slug, createdAt: now })
          .onConflictDoNothing(),
      );
    }
    statements.push(this.db.delete(textTag).where(eq(textTag.textId, textId)));
    for (const slug of unique) {
      statements.push(this.db.insert(textTag).values({ textId, tagId: tagId(slug) }));
    }
    return statements;
  }

  // Statements replacing a text's wikilinks; each `[[slug]]` resolves to a text
  // entry or is marked dangling.
  private async wikilinkStatements(textId: string, body: string, now: number): Promise<Stmt[]> {
    const targets = parseWikilinkTargets(body);
    const statements: Stmt[] = [this.db.delete(textLink).where(eq(textLink.fromTextId, textId))];
    if (targets.length === 0) return statements;

    const resolved = await this.db
      .select({ id: textEntry.id, slug: textEntry.slug })
      .from(textEntry)
      .where(inArray(textEntry.slug, targets));
    const bySlug = new Map(resolved.map((r) => [r.slug, r.id]));

    for (const slug of targets) {
      const toTextId = bySlug.get(slug) ?? null;
      statements.push(
        this.db.insert(textLink).values({
          id: crypto.randomUUID(),
          fromTextId: textId,
          toTextId,
          toSlug: slug,
          isDangling: toTextId === null ? 1 : 0,
          createdAt: now,
        }),
      );
    }
    return statements;
  }

  // ── shared reads ───────────────────────────────────────────────────────────

  private async textExists(textId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(textEntry)
      .where(eq(textEntry.id, textId))
      .limit(1);
    return row !== undefined;
  }

  private async softwareExists(softwareId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(softwareEntry)
      .where(eq(softwareEntry.id, softwareId))
      .limit(1);
    return row !== undefined;
  }

  private async pageExists(key: PageKey): Promise<boolean> {
    const [row] = await this.db
      .select({ id: pageEntry.id })
      .from(pageEntry)
      .where(eq(pageEntry.pageKey, key))
      .limit(1);
    return row !== undefined;
  }

  // Parse + validate a stored page document (INV-PAGE-1). Non-JSON or invalid
  // content resolves to null (logged) rather than surfacing an invalid document.
  private parsePageDocument<K extends PageKey>(
    key: K,
    documentJson: string,
  ): PageDocumentByKey[K] | null {
    let raw: unknown;
    try {
      raw = JSON.parse(documentJson);
    } catch {
      console.error("publisher: page document is not JSON", { key });
      return null;
    }
    const validated = validatePageDocument(key, raw);
    if (!validated.ok) {
      console.error("publisher: page document failed validation", {
        key,
        reason: validated.message,
      });
      return null;
    }
    return validated.value;
  }

  // The subset of `ids` that resolve to a published software record — the gate
  // for a page's `featuredSoftwareId` (RFC-0001 "Fixed page document contracts").
  private async publishedSoftwareIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: softwarePublication.softwareId })
      .from(softwarePublication)
      .innerJoin(softwareEntry, eq(softwareEntry.id, softwarePublication.softwareId))
      .where(
        and(inArray(softwarePublication.softwareId, ids), eq(softwareEntry.state, "published")),
      );
    return new Set(rows.map((r) => r.id));
  }

  // The subset of `ids` that resolve to a published text (an active release
  // pointer) — the gate for a page's `featuredTextId`, mirroring software.
  private async publishedTextIds(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const rows = await this.db
      .select({ id: textEntry.id })
      .from(textEntry)
      .where(
        and(
          inArray(textEntry.id, ids),
          eq(textEntry.state, "published"),
          isNotNull(textEntry.activeReleaseId),
        ),
      );
    return new Set(rows.map((r) => r.id));
  }

  // Page-owned media rows for the referenced ids; the caller compares the count
  // against the requested ids to reject any not owned by the page (INV-DOM-1).
  private async pageOwnedMedia(
    pageId: string,
    mediaIds: string[],
  ): Promise<schema.PublisherMediaRow[]> {
    if (mediaIds.length === 0) return [];
    return this.db
      .select()
      .from(publisherMedia)
      .where(
        and(
          eq(publisherMedia.ownerType, "page"),
          eq(publisherMedia.ownerId, pageId),
          inArray(publisherMedia.id, mediaIds),
        ),
      );
  }

  private async textSlugExists(slug: string, exceptId: string | null): Promise<boolean> {
    const [row] = await this.db
      .select({ id: textEntry.id })
      .from(textEntry)
      .where(eq(textEntry.slug, slug))
      .limit(1);
    return row !== undefined && row.id !== exceptId;
  }

  private async softwareSlugExists(slug: string, exceptId: string | null): Promise<boolean> {
    const [row] = await this.db
      .select({ id: softwareEntry.id })
      .from(softwareEntry)
      .where(eq(softwareEntry.slug, slug))
      .limit(1);
    return row !== undefined && row.id !== exceptId;
  }

  private async mediaOwnedBy(
    mediaId: string,
    ownerType: "text" | "software" | "page",
    ownerId: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select({ id: publisherMedia.id })
      .from(publisherMedia)
      .where(
        and(
          eq(publisherMedia.id, mediaId),
          eq(publisherMedia.ownerType, ownerType),
          eq(publisherMedia.ownerId, ownerId),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  // Resolve a media owner to the id persisted on `publisher_media.owner_id`.
  // text/software own by their entry id; a page owns by its internal id, which
  // the caller addresses by PageKey. Returns null when the owner does not exist.
  private async resolveMediaOwner(
    ownerType: "text" | "software" | "page",
    ownerId: string,
  ): Promise<string | null> {
    if (ownerType === "text") return (await this.textExists(ownerId)) ? ownerId : null;
    if (ownerType === "software") return (await this.softwareExists(ownerId)) ? ownerId : null;
    const [row] = await this.db
      .select({ id: pageEntry.id })
      .from(pageEntry)
      .where(eq(pageEntry.pageKey, ownerId as PageKey))
      .limit(1);
    return row?.id ?? null;
  }

  // Next append position for an owner's media (max existing + 1).
  private async nextMediaPosition(
    ownerType: "text" | "software" | "page",
    ownerId: string,
  ): Promise<number> {
    const [last] = await this.db
      .select({ position: publisherMedia.position })
      .from(publisherMedia)
      .where(and(eq(publisherMedia.ownerType, ownerType), eq(publisherMedia.ownerId, ownerId)))
      .orderBy(desc(publisherMedia.position))
      .limit(1);
    return last ? last.position + 1 : 0;
  }

  private async loadTags(textId: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: tag.slug })
      .from(textTag)
      .innerJoin(tag, eq(tag.id, textTag.tagId))
      .where(eq(textTag.textId, textId))
      .orderBy(asc(tag.slug));
    return rows.map((r) => r.slug);
  }

  private async loadTagsByText(textIds: string[]): Promise<Map<string, string[]>> {
    const grouped = new Map<string, string[]>();
    if (textIds.length === 0) return grouped;
    const rows = await this.db
      .select({ textId: textTag.textId, slug: tag.slug })
      .from(textTag)
      .innerJoin(tag, eq(tag.id, textTag.tagId))
      .where(inArray(textTag.textId, textIds))
      .orderBy(asc(tag.slug));
    for (const row of rows) {
      const list = grouped.get(row.textId) ?? [];
      list.push(row.slug);
      grouped.set(row.textId, list);
    }
    return grouped;
  }

  private async loadReadyMedia(
    ownerType: "text" | "software" | "page",
    ownerId: string,
  ): Promise<schema.PublisherMediaRow[]> {
    return this.db
      .select()
      .from(publisherMedia)
      .where(
        and(
          eq(publisherMedia.ownerType, ownerType),
          eq(publisherMedia.ownerId, ownerId),
          eq(publisherMedia.state, "ready"),
        ),
      )
      .orderBy(asc(publisherMedia.position), asc(publisherMedia.id));
  }

  // Non-pending media owned by a record, for the operator detail views.
  private async loadOwnedMedia(
    ownerType: "text" | "software" | "page",
    ownerId: string,
  ): Promise<PublisherMediaDTO[]> {
    const rows = await this.db
      .select()
      .from(publisherMedia)
      .where(
        and(
          eq(publisherMedia.ownerType, ownerType),
          eq(publisherMedia.ownerId, ownerId),
          inArray(publisherMedia.state, ["ready", "failed"]),
        ),
      )
      .orderBy(asc(publisherMedia.position), asc(publisherMedia.id));
    return rows.map(toPublisherMediaDTO);
  }

  private async loadTextDraftDTO(textId: string): Promise<TextDraftDTO | null> {
    const [row] = await this.db
      .select({
        slug: textEntry.slug,
        state: textEntry.state,
        updatedAt: textEntry.updatedAt,
        revision: textDraft.revision,
        title: textDraft.title,
        deck: textDraft.deck,
        bodyMarkdown: textDraft.bodyMarkdown,
        activeVersion: textRelease.version,
      })
      .from(textEntry)
      .innerJoin(textDraft, eq(textDraft.textId, textEntry.id))
      .leftJoin(textRelease, eq(textRelease.id, textEntry.activeReleaseId))
      .where(eq(textEntry.id, textId))
      .limit(1);
    if (!row) return null;
    return {
      textId,
      slug: row.slug,
      revision: row.revision,
      title: row.title,
      deck: row.deck,
      bodyMarkdown: row.bodyMarkdown,
      tags: await this.loadTags(textId),
      activeVersion: row.activeVersion ?? null,
      state: row.state,
      updatedAt: row.updatedAt,
    };
  }

  private async loadSoftwareDraftDTO(softwareId: string): Promise<SoftwareDraftDTO | null> {
    const [row] = await this.db
      .select({
        slug: softwareEntry.slug,
        state: softwareEntry.state,
        updatedAt: softwareEntry.updatedAt,
        revision: softwareDraft.revision,
        title: softwareDraft.title,
        deck: softwareDraft.deck,
        whatItIsMarkdown: softwareDraft.whatItIsMarkdown,
        destinationUrl: softwareDraft.destinationUrl,
        actionLabel: softwareDraft.actionLabel,
        primaryMediaId: softwareDraft.primaryMediaId,
        publishedUpdatedAt: softwarePublication.updatedAt,
      })
      .from(softwareEntry)
      .innerJoin(softwareDraft, eq(softwareDraft.softwareId, softwareEntry.id))
      .leftJoin(softwarePublication, eq(softwarePublication.softwareId, softwareEntry.id))
      .where(eq(softwareEntry.id, softwareId))
      .limit(1);
    if (!row) return null;
    return {
      softwareId,
      slug: row.slug,
      revision: row.revision,
      title: row.title,
      deck: row.deck,
      whatItIsMarkdown: row.whatItIsMarkdown,
      destinationUrl: row.destinationUrl,
      actionLabel: row.actionLabel,
      primaryMediaId: row.primaryMediaId,
      state: row.state,
      publishedUpdatedAt: row.publishedUpdatedAt ?? null,
      updatedAt: row.updatedAt,
    };
  }

  private async loadPublishedSoftware(softwareId: string): Promise<PublishedSoftwareDTO | null> {
    const [row] = await this.db
      .select({
        slug: softwarePublication.slug,
        title: softwarePublication.title,
        deck: softwarePublication.deck,
        whatItIsMarkdown: softwarePublication.whatItIsMarkdown,
        destinationUrl: softwarePublication.destinationUrl,
        actionLabel: softwarePublication.actionLabel,
        primaryMediaId: softwarePublication.primaryMediaId,
        updatedAt: softwarePublication.updatedAt,
      })
      .from(softwarePublication)
      .where(eq(softwarePublication.softwareId, softwareId))
      .limit(1);
    if (!row) return null;

    const mediaRows = await this.db
      .select({
        mediaId: softwarePublicationMedia.mediaId,
        role: softwarePublicationMedia.role,
        alt: softwarePublicationMedia.alt,
        position: softwarePublicationMedia.position,
        contentType: publisherMedia.contentType,
        width: publisherMedia.width,
        height: publisherMedia.height,
      })
      .from(softwarePublicationMedia)
      .innerJoin(publisherMedia, eq(publisherMedia.id, softwarePublicationMedia.mediaId))
      .where(eq(softwarePublicationMedia.softwareId, softwareId))
      .orderBy(asc(softwarePublicationMedia.position), asc(softwarePublicationMedia.mediaId));
    const media = mediaRows.map(toMediaRef);
    const primaryMedia =
      row.primaryMediaId !== null ? (media.find((m) => m.id === row.primaryMediaId) ?? null) : null;

    return {
      id: softwareId,
      slug: row.slug,
      title: row.title,
      deck: row.deck,
      primaryMedia,
      updatedAt: row.updatedAt,
      whatItIsMarkdown: row.whatItIsMarkdown,
      destinationUrl: row.destinationUrl,
      actionLabel: row.actionLabel,
      media,
    };
  }

  // ── deletion + media GC (T18, D8/D10, INV-DEL-1/3/4) ──────────────────────────

  // Mint a short-lived deletion intent: persist the token HASH + canonical impact
  // hash bound to operator/plan-action/target, hand the clear token to the caller
  // (INV-DEL-3). The token is never stored in clear; the impact hash lets confirm
  // detect any dependency-graph drift.
  private async mintPlan(
    planAction: string,
    descriptor: string,
    impact: DeletionImpact,
    meta: OperatorMeta,
  ): Promise<DeletionPlan> {
    const token = randomToken();
    const now = Date.now();
    const expiresAt = now + DELETION_TTL_MS;
    await this.db.insert(operatorDeletionIntent).values({
      tokenHash: await sha256Hex(token),
      operatorSub: meta.actor.sub,
      action: planAction,
      targetId: descriptor,
      impactHash: await sha256Hex(canonicalJson(impact)),
      expiresAt,
      consumedAt: null,
    });
    return { impact, confirmationToken: token, expiresAt };
  }

  // Resolve a confirmation token to its live intent, enforcing the actor/action
  // binding, single-use (consumedAt), and expiry rules. Impact-drift is checked
  // by the caller after re-deriving the impact from the stored descriptor.
  private async loadValidIntent(
    planAction: string,
    meta: OperatorMeta,
    token: string,
  ): Promise<
    { ok: true; intent: schema.OperatorDeletionIntentRow } | { ok: false; error: DeletionError }
  > {
    const [intent] = await this.db
      .select()
      .from(operatorDeletionIntent)
      .where(eq(operatorDeletionIntent.tokenHash, await sha256Hex(token)))
      .limit(1);
    // Unknown token, or one minted for a different operator/plan-action, is not a
    // usable intent for this call.
    if (!intent) return { ok: false, error: "not_found" };
    if (intent.operatorSub !== meta.actor.sub) return { ok: false, error: "not_found" };
    if (intent.action !== planAction) return { ok: false, error: "not_found" };
    if (intent.consumedAt !== null) return { ok: false, error: "deletion_already_executed" };
    if (intent.expiresAt <= Date.now()) return { ok: false, error: "deletion_plan_expired" };
    return { ok: true, intent };
  }

  // Consume a validated intent in the SAME batch as its deletion (single-use).
  private consumeIntentStmt(tokenHash: string, now: number): Stmt {
    return this.db
      .update(operatorDeletionIntent)
      .set({ consumedAt: now })
      .where(eq(operatorDeletionIntent.tokenHash, tokenHash));
  }

  // A media_gc_outbox row for a logically-deleted storage key (INV-DEL-4). The
  // physical byte delete is async + retryable and can never restore eligibility.
  private gcOutboxStmt(storageKey: string, now: number): Stmt {
    return this.db.insert(mediaGcOutbox).values({
      id: crypto.randomUUID(),
      storageKey,
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      createdAt: now,
    });
  }

  private async countRows(table: SQLiteTable, where: SQL | undefined): Promise<number> {
    const [row] = await this.db.select({ value: count() }).from(table).where(where);
    return row?.value ?? 0;
  }

  // publisher_release_media rows snapshotting a set of releases of one owner type.
  private async releaseMediaCount(
    ownerType: "text" | "page",
    releaseIds: string[],
  ): Promise<number> {
    if (releaseIds.length === 0) return 0;
    const [row] = await this.db
      .select({ value: count() })
      .from(publisherReleaseMedia)
      .where(
        and(
          eq(publisherReleaseMedia.ownerType, ownerType),
          inArray(publisherReleaseMedia.releaseId, releaseIds),
        ),
      );
    return row?.value ?? 0;
  }

  private async releaseVersion(releaseId: string, kind: "text" | "page"): Promise<string | null> {
    const table = kind === "text" ? textRelease : pageRelease;
    const [row] = await this.db
      .select({ version: table.version })
      .from(table)
      .where(eq(table.id, releaseId))
      .limit(1);
    return row?.version ?? null;
  }

  // Count active fixed pages whose published document features a given text or
  // software record — the "safe dangling references" a deletion warns about (D8).
  private async countPagesFeaturing(kind: "text" | "software", id: string): Promise<number> {
    const rows = await this.db
      .select({ key: pageEntry.pageKey, documentJson: pageRelease.documentJson })
      .from(pageEntry)
      .innerJoin(pageRelease, eq(pageRelease.id, pageEntry.activeReleaseId));
    let n = 0;
    for (const row of rows) {
      const doc = this.parsePageDocument(row.key, row.documentJson);
      if (doc === null || doc.key !== "home") continue;
      if (kind === "text" && doc.sections.texts.featuredTextId === id) n += 1;
      else if (kind === "software" && doc.sections.systems.featuredSoftwareId === id) n += 1;
    }
    return n;
  }

  // Number of ACTIVE public references to a media id: the active release of a
  // published text/page, or a published software publication (mirrors the public
  // reads eligibility rule).
  private async countActiveMediaRefs(mediaId: string): Promise<number> {
    const [textRow] = await this.db
      .select({ value: count() })
      .from(publisherReleaseMedia)
      .innerJoin(textEntry, eq(textEntry.activeReleaseId, publisherReleaseMedia.releaseId))
      .where(
        and(
          eq(publisherReleaseMedia.mediaId, mediaId),
          eq(publisherReleaseMedia.ownerType, "text"),
          eq(textEntry.state, "published"),
        ),
      );
    const [pageRow] = await this.db
      .select({ value: count() })
      .from(publisherReleaseMedia)
      .innerJoin(pageEntry, eq(pageEntry.activeReleaseId, publisherReleaseMedia.releaseId))
      .where(
        and(
          eq(publisherReleaseMedia.mediaId, mediaId),
          eq(publisherReleaseMedia.ownerType, "page"),
        ),
      );
    const [softwareRow] = await this.db
      .select({ value: count() })
      .from(softwarePublicationMedia)
      .innerJoin(softwareEntry, eq(softwareEntry.id, softwarePublicationMedia.softwareId))
      .where(
        and(eq(softwarePublicationMedia.mediaId, mediaId), eq(softwareEntry.state, "published")),
      );
    return (textRow?.value ?? 0) + (pageRow?.value ?? 0) + (softwareRow?.value ?? 0);
  }

  // ── text release deletion ────────────────────────────────────────────────────

  // Impact preview for deleting one text release; null when the release/entry no
  // longer exists or the named replacement is invalid (confirm-time drift).
  private async buildTextReleaseImpact(
    textId: string,
    releaseId: string,
    replacementReleaseId: string | null,
  ): Promise<DeletionImpact | null> {
    const [entry] = await this.db
      .select({ activeReleaseId: textEntry.activeReleaseId })
      .from(textEntry)
      .where(eq(textEntry.id, textId))
      .limit(1);
    if (!entry) return null;
    const [release] = await this.db
      .select({ version: textRelease.version })
      .from(textRelease)
      .where(and(eq(textRelease.id, releaseId), eq(textRelease.textId, textId)))
      .limit(1);
    if (!release) return null;

    let replacementVersion: string | null = null;
    if (replacementReleaseId !== null) {
      const [r] = await this.db
        .select({ version: textRelease.version })
        .from(textRelease)
        .where(and(eq(textRelease.id, replacementReleaseId), eq(textRelease.textId, textId)))
        .limit(1);
      if (!r || replacementReleaseId === releaseId) return null;
      replacementVersion = r.version;
    }

    const releaseMedia = await this.releaseMediaCount("text", [releaseId]);
    const totalReleases = await this.countRows(textRelease, eq(textRelease.textId, textId));
    const activeAffected = entry.activeReleaseId === releaseId;
    const warnings: string[] = [];
    if (activeAffected && replacementVersion !== null) {
      warnings.push(`The active release will be repointed to version ${replacementVersion}.`);
    } else if (activeAffected) {
      warnings.push("Deleting the active release returns this text to draft.");
    }
    return {
      targetType: "text_release",
      targetId: releaseId,
      label: release.version,
      activeReleaseAffected: activeAffected,
      deleteCounts: { releases: 1, releaseMedia },
      retainedCounts: { siblingReleases: totalReleases - 1 },
      warnings,
    };
  }

  async planTextReleaseDeletion(
    call: OperatorCall<{ textId: string; releaseId: string; replacementReleaseId?: string | null }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">> {
    const { input, meta } = call;
    const replacementReleaseId = input.replacementReleaseId ?? null;
    const [entry] = await this.db
      .select({ id: textEntry.id })
      .from(textEntry)
      .where(eq(textEntry.id, input.textId))
      .limit(1);
    if (!entry) return err("not_found");
    const [release] = await this.db
      .select({ id: textRelease.id })
      .from(textRelease)
      .where(and(eq(textRelease.id, input.releaseId), eq(textRelease.textId, input.textId)))
      .limit(1);
    if (!release) return err("not_found");
    if (replacementReleaseId !== null) {
      const [r] = await this.db
        .select({ id: textRelease.id })
        .from(textRelease)
        .where(and(eq(textRelease.id, replacementReleaseId), eq(textRelease.textId, input.textId)))
        .limit(1);
      if (!r || replacementReleaseId === input.releaseId) return err("invalid_replacement");
    }
    const impact = await this.buildTextReleaseImpact(
      input.textId,
      input.releaseId,
      replacementReleaseId,
    );
    if (!impact) return err("not_found");
    const descriptor = JSON.stringify({
      textId: input.textId,
      releaseId: input.releaseId,
      replacementReleaseId,
    });
    return ok(await this.mintPlan(ACTIONS.textReleaseDeletePlan, descriptor, impact, meta));
  }

  async deleteTextRelease(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>> {
    const { input, meta } = call;
    const replay = await this.replayed<{ deleted: true; activeVersion: string | null }>(
      ACTIONS.textReleaseDelete,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const valid = await this.loadValidIntent(
      ACTIONS.textReleaseDeletePlan,
      meta,
      input.confirmationToken,
    );
    if (!valid.ok) return err(valid.error);
    const { textId, releaseId, replacementReleaseId } = JSON.parse(valid.intent.targetId) as {
      textId: string;
      releaseId: string;
      replacementReleaseId: string | null;
    };
    const impact = await this.buildTextReleaseImpact(textId, releaseId, replacementReleaseId);
    if (!impact) return err("deletion_plan_mismatch");
    if ((await sha256Hex(canonicalJson(impact))) !== valid.intent.impactHash) {
      return err("deletion_plan_mismatch");
    }

    const [entry] = await this.db
      .select({ activeReleaseId: textEntry.activeReleaseId })
      .from(textEntry)
      .where(eq(textEntry.id, textId))
      .limit(1);
    if (!entry) return err("deletion_plan_mismatch");

    const now = Date.now();
    const activeAffected = entry.activeReleaseId === releaseId;
    const statements: Stmt[] = [];
    let activeVersion: string | null;
    if (activeAffected && replacementReleaseId !== null) {
      // Repoint BEFORE deleting the row so the entry's SET NULL FK never fires;
      // state is left as-is (a repointed active release stays published).
      statements.push(
        this.db
          .update(textEntry)
          .set({ activeReleaseId: replacementReleaseId, updatedAt: now })
          .where(eq(textEntry.id, textId)),
      );
      activeVersion = await this.releaseVersion(replacementReleaseId, "text");
    } else if (activeAffected) {
      statements.push(
        this.db
          .update(textEntry)
          .set({ activeReleaseId: null, state: "draft", updatedAt: now })
          .where(eq(textEntry.id, textId)),
      );
      activeVersion = null;
    } else {
      activeVersion =
        entry.activeReleaseId === null
          ? null
          : await this.releaseVersion(entry.activeReleaseId, "text");
    }
    statements.push(
      this.db
        .delete(publisherReleaseMedia)
        .where(
          and(
            eq(publisherReleaseMedia.ownerType, "text"),
            eq(publisherReleaseMedia.releaseId, releaseId),
          ),
        ),
      this.db.delete(textRelease).where(eq(textRelease.id, releaseId)),
      this.consumeIntentStmt(valid.intent.tokenHash, now),
    );
    const value = { deleted: true as const, activeVersion };
    statements.push(
      this.eventStmt({
        action: ACTIONS.textReleaseDelete,
        targetType: "text_release",
        targetId: releaseId,
        meta,
        value,
        now,
        detail: this.tombstone(impact),
      }),
    );
    return this.commit(ACTIONS.textReleaseDelete, meta, statements, value);
  }

  // ── text aggregate deletion ────────────────────────────────────────────────────

  private async buildTextImpact(textId: string): Promise<DeletionImpact | null> {
    const [entry] = await this.db
      .select({ slug: textEntry.slug, activeReleaseId: textEntry.activeReleaseId })
      .from(textEntry)
      .where(eq(textEntry.id, textId))
      .limit(1);
    if (!entry) return null;

    const releaseIds = (
      await this.db
        .select({ id: textRelease.id })
        .from(textRelease)
        .where(eq(textRelease.textId, textId))
    ).map((r) => r.id);
    const releaseMedia = await this.releaseMediaCount("text", releaseIds);
    const media = await this.countRows(
      publisherMedia,
      and(eq(publisherMedia.ownerType, "text"), eq(publisherMedia.ownerId, textId)),
    );
    const tagLinks = await this.countRows(textTag, eq(textTag.textId, textId));
    const wikilinks = await this.countRows(textLink, eq(textLink.fromTextId, textId));
    const inboundWikilinks = await this.countRows(textLink, eq(textLink.toTextId, textId));
    const referencingPages = await this.countPagesFeaturing("text", textId);

    const warnings: string[] = [];
    if (entry.activeReleaseId !== null) {
      warnings.push("This text is currently published; its public page will 404 once deleted.");
    }
    if (inboundWikilinks > 0) {
      warnings.push(`${inboundWikilinks} wikilink(s) from other texts will dangle.`);
    }
    if (referencingPages > 0) {
      warnings.push(
        `${referencingPages} published page(s) feature this text; those references will dangle.`,
      );
    }
    return {
      targetType: "text",
      targetId: textId,
      label: entry.slug,
      activeReleaseAffected: entry.activeReleaseId !== null,
      deleteCounts: { releases: releaseIds.length, releaseMedia, media, tagLinks, wikilinks },
      retainedCounts: { inboundWikilinks, referencingPages },
      warnings,
    };
  }

  async planTextDeletion(
    call: OperatorCall<{ textId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    const impact = await this.buildTextImpact(call.input.textId);
    if (!impact) return err("not_found");
    const descriptor = JSON.stringify({ textId: call.input.textId });
    return ok(await this.mintPlan(ACTIONS.textDeletePlan, descriptor, impact, call.meta));
  }

  async deleteText(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    const { input, meta } = call;
    const replay = await this.replayed<{ deleted: true }>(ACTIONS.textDelete, meta.idempotencyKey);
    if (replay !== null) return ok(replay);

    const valid = await this.loadValidIntent(ACTIONS.textDeletePlan, meta, input.confirmationToken);
    if (!valid.ok) return err(valid.error);
    const { textId } = JSON.parse(valid.intent.targetId) as { textId: string };
    const impact = await this.buildTextImpact(textId);
    if (!impact) return err("deletion_plan_mismatch");
    if ((await sha256Hex(canonicalJson(impact))) !== valid.intent.impactHash) {
      return err("deletion_plan_mismatch");
    }

    const now = Date.now();
    const storageKeys = (
      await this.db
        .select({ storageKey: publisherMedia.storageKey })
        .from(publisherMedia)
        .where(and(eq(publisherMedia.ownerType, "text"), eq(publisherMedia.ownerId, textId)))
    ).map((r) => r.storageKey);
    const releaseIds = (
      await this.db
        .select({ id: textRelease.id })
        .from(textRelease)
        .where(eq(textRelease.textId, textId))
    ).map((r) => r.id);

    const statements: Stmt[] = [
      // Break the entry→release pointer, then flip inbound wikilinks to dangling
      // BEFORE the rows they point at vanish (SET NULL would otherwise leave a
      // resolved-but-null link).
      this.db.update(textEntry).set({ activeReleaseId: null }).where(eq(textEntry.id, textId)),
      this.db
        .update(textLink)
        .set({ toTextId: null, isDangling: 1 })
        .where(eq(textLink.toTextId, textId)),
    ];
    if (releaseIds.length > 0) {
      statements.push(
        this.db
          .delete(publisherReleaseMedia)
          .where(
            and(
              eq(publisherReleaseMedia.ownerType, "text"),
              inArray(publisherReleaseMedia.releaseId, releaseIds),
            ),
          ),
      );
    }
    statements.push(
      this.db
        .delete(publisherMedia)
        .where(and(eq(publisherMedia.ownerType, "text"), eq(publisherMedia.ownerId, textId))),
      this.db.delete(textTag).where(eq(textTag.textId, textId)),
      this.db.delete(textLink).where(eq(textLink.fromTextId, textId)),
      this.db.delete(textRelease).where(eq(textRelease.textId, textId)),
      this.db.delete(textDraft).where(eq(textDraft.textId, textId)),
      this.db.delete(textEntry).where(eq(textEntry.id, textId)),
      ...storageKeys.map((key) => this.gcOutboxStmt(key, now)),
      this.consumeIntentStmt(valid.intent.tokenHash, now),
    );
    const value = { deleted: true as const };
    statements.push(
      this.eventStmt({
        action: ACTIONS.textDelete,
        targetType: "text",
        targetId: textId,
        meta,
        value,
        now,
        detail: this.tombstone(impact),
      }),
    );
    return this.commit(ACTIONS.textDelete, meta, statements, value);
  }

  // ── software aggregate deletion ──────────────────────────────────────────────

  private async buildSoftwareImpact(softwareId: string): Promise<DeletionImpact | null> {
    const [entry] = await this.db
      .select({ slug: softwareEntry.slug })
      .from(softwareEntry)
      .where(eq(softwareEntry.id, softwareId))
      .limit(1);
    if (!entry) return null;

    const publications = await this.countRows(
      softwarePublication,
      eq(softwarePublication.softwareId, softwareId),
    );
    const publicationMedia = await this.countRows(
      softwarePublicationMedia,
      eq(softwarePublicationMedia.softwareId, softwareId),
    );
    const media = await this.countRows(
      publisherMedia,
      and(eq(publisherMedia.ownerType, "software"), eq(publisherMedia.ownerId, softwareId)),
    );
    const referencingPages = await this.countPagesFeaturing("software", softwareId);

    const warnings: string[] = [];
    if (publications > 0) {
      warnings.push("This software is currently published; its public page will 404 once deleted.");
    }
    if (referencingPages > 0) {
      warnings.push(
        `${referencingPages} published page(s) feature this software; those references will dangle.`,
      );
    }
    return {
      targetType: "software",
      targetId: softwareId,
      label: entry.slug,
      activeReleaseAffected: publications > 0,
      deleteCounts: { publications, publicationMedia, media },
      retainedCounts: { referencingPages },
      warnings,
    };
  }

  async planSoftwareDeletion(
    call: OperatorCall<{ softwareId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    const impact = await this.buildSoftwareImpact(call.input.softwareId);
    if (!impact) return err("not_found");
    const descriptor = JSON.stringify({ softwareId: call.input.softwareId });
    return ok(await this.mintPlan(ACTIONS.softwareDeletePlan, descriptor, impact, call.meta));
  }

  async deleteSoftware(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    const { input, meta } = call;
    const replay = await this.replayed<{ deleted: true }>(
      ACTIONS.softwareDelete,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const valid = await this.loadValidIntent(
      ACTIONS.softwareDeletePlan,
      meta,
      input.confirmationToken,
    );
    if (!valid.ok) return err(valid.error);
    const { softwareId } = JSON.parse(valid.intent.targetId) as { softwareId: string };
    const impact = await this.buildSoftwareImpact(softwareId);
    if (!impact) return err("deletion_plan_mismatch");
    if ((await sha256Hex(canonicalJson(impact))) !== valid.intent.impactHash) {
      return err("deletion_plan_mismatch");
    }

    const now = Date.now();
    const storageKeys = (
      await this.db
        .select({ storageKey: publisherMedia.storageKey })
        .from(publisherMedia)
        .where(
          and(eq(publisherMedia.ownerType, "software"), eq(publisherMedia.ownerId, softwareId)),
        )
    ).map((r) => r.storageKey);

    const statements: Stmt[] = [
      this.db
        .delete(softwarePublicationMedia)
        .where(eq(softwarePublicationMedia.softwareId, softwareId)),
      this.db
        .delete(publisherMedia)
        .where(
          and(eq(publisherMedia.ownerType, "software"), eq(publisherMedia.ownerId, softwareId)),
        ),
      this.db.delete(softwarePublication).where(eq(softwarePublication.softwareId, softwareId)),
      this.db.delete(softwareDraft).where(eq(softwareDraft.softwareId, softwareId)),
      this.db.delete(softwareEntry).where(eq(softwareEntry.id, softwareId)),
      ...storageKeys.map((key) => this.gcOutboxStmt(key, now)),
      this.consumeIntentStmt(valid.intent.tokenHash, now),
    ];
    const value = { deleted: true as const };
    statements.push(
      this.eventStmt({
        action: ACTIONS.softwareDelete,
        targetType: "software",
        targetId: softwareId,
        meta,
        value,
        now,
        detail: this.tombstone(impact),
      }),
    );
    return this.commit(ACTIONS.softwareDelete, meta, statements, value);
  }

  // ── tag deletion ─────────────────────────────────────────────────────────────

  private async buildTagImpact(tagId: string): Promise<DeletionImpact | null> {
    const [row] = await this.db
      .select({ slug: tag.slug })
      .from(tag)
      .where(eq(tag.id, tagId))
      .limit(1);
    if (!row) return null;
    const taggedTexts = await this.countRows(textTag, eq(textTag.tagId, tagId));
    const warnings: string[] = [];
    if (taggedTexts > 0) {
      warnings.push(`${taggedTexts} text(s) use this tag and remain unchanged.`);
    }
    return {
      targetType: "tag",
      targetId: tagId,
      label: row.slug,
      activeReleaseAffected: false,
      deleteCounts: { tags: 1, tagLinks: taggedTexts },
      retainedCounts: { taggedTexts },
      warnings,
    };
  }

  async planTagDeletion(
    call: OperatorCall<{ tagId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    const impact = await this.buildTagImpact(call.input.tagId);
    if (!impact) return err("not_found");
    const descriptor = JSON.stringify({ tagId: call.input.tagId });
    return ok(await this.mintPlan(ACTIONS.tagDeletePlan, descriptor, impact, call.meta));
  }

  async deleteTag(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    const { input, meta } = call;
    const replay = await this.replayed<{ deleted: true }>(ACTIONS.tagDelete, meta.idempotencyKey);
    if (replay !== null) return ok(replay);

    const valid = await this.loadValidIntent(ACTIONS.tagDeletePlan, meta, input.confirmationToken);
    if (!valid.ok) return err(valid.error);
    const { tagId } = JSON.parse(valid.intent.targetId) as { tagId: string };
    const impact = await this.buildTagImpact(tagId);
    if (!impact) return err("deletion_plan_mismatch");
    if ((await sha256Hex(canonicalJson(impact))) !== valid.intent.impactHash) {
      return err("deletion_plan_mismatch");
    }

    const now = Date.now();
    const statements: Stmt[] = [
      this.db.delete(textTag).where(eq(textTag.tagId, tagId)),
      this.db.delete(tag).where(eq(tag.id, tagId)),
      this.consumeIntentStmt(valid.intent.tokenHash, now),
    ];
    const value = { deleted: true as const };
    statements.push(
      this.eventStmt({
        action: ACTIONS.tagDelete,
        targetType: "tag",
        targetId: tagId,
        meta,
        value,
        now,
        detail: this.tombstone(impact),
      }),
    );
    return this.commit(ACTIONS.tagDelete, meta, statements, value);
  }

  // ── page release deletion ──────────────────────────────────────────────────────

  private async buildPageReleaseImpact(
    pageKey: PageKey,
    releaseId: string,
    replacementReleaseId: string | null,
  ): Promise<DeletionImpact | null> {
    const [entry] = await this.db
      .select({ id: pageEntry.id, activeReleaseId: pageEntry.activeReleaseId })
      .from(pageEntry)
      .where(eq(pageEntry.pageKey, pageKey))
      .limit(1);
    if (!entry) return null;
    const [release] = await this.db
      .select({ version: pageRelease.version })
      .from(pageRelease)
      .where(and(eq(pageRelease.id, releaseId), eq(pageRelease.pageId, entry.id)))
      .limit(1);
    if (!release) return null;

    let replacementVersion: string | null = null;
    if (replacementReleaseId !== null) {
      const [r] = await this.db
        .select({ version: pageRelease.version })
        .from(pageRelease)
        .where(and(eq(pageRelease.id, replacementReleaseId), eq(pageRelease.pageId, entry.id)))
        .limit(1);
      if (!r || replacementReleaseId === releaseId) return null;
      replacementVersion = r.version;
    }

    const releaseMedia = await this.releaseMediaCount("page", [releaseId]);
    const totalReleases = await this.countRows(pageRelease, eq(pageRelease.pageId, entry.id));
    const activeAffected = entry.activeReleaseId === releaseId;
    const warnings: string[] = [];
    if (activeAffected && replacementVersion !== null) {
      warnings.push(`The active release will be repointed to version ${replacementVersion}.`);
    } else if (activeAffected) {
      warnings.push("The page will have no published document until republished.");
    }
    return {
      targetType: "page_release",
      targetId: releaseId,
      label: release.version,
      activeReleaseAffected: activeAffected,
      deleteCounts: { releases: 1, releaseMedia },
      retainedCounts: { siblingReleases: totalReleases - 1 },
      warnings,
    };
  }

  async planPageReleaseDeletion(
    call: OperatorCall<{ key: PageKey; releaseId: string; replacementReleaseId?: string | null }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">> {
    const { input, meta } = call;
    const replacementReleaseId = input.replacementReleaseId ?? null;
    const [entry] = await this.db
      .select({ id: pageEntry.id })
      .from(pageEntry)
      .where(eq(pageEntry.pageKey, input.key))
      .limit(1);
    if (!entry) return err("not_found");
    const [release] = await this.db
      .select({ id: pageRelease.id })
      .from(pageRelease)
      .where(and(eq(pageRelease.id, input.releaseId), eq(pageRelease.pageId, entry.id)))
      .limit(1);
    if (!release) return err("not_found");
    if (replacementReleaseId !== null) {
      const [r] = await this.db
        .select({ id: pageRelease.id })
        .from(pageRelease)
        .where(and(eq(pageRelease.id, replacementReleaseId), eq(pageRelease.pageId, entry.id)))
        .limit(1);
      if (!r || replacementReleaseId === input.releaseId) return err("invalid_replacement");
    }
    const impact = await this.buildPageReleaseImpact(
      input.key,
      input.releaseId,
      replacementReleaseId,
    );
    if (!impact) return err("not_found");
    const descriptor = JSON.stringify({
      pageKey: input.key,
      releaseId: input.releaseId,
      replacementReleaseId,
    });
    return ok(await this.mintPlan(ACTIONS.pageReleaseDeletePlan, descriptor, impact, meta));
  }

  async deletePageRelease(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>> {
    const { input, meta } = call;
    const replay = await this.replayed<{ deleted: true; activeVersion: string | null }>(
      ACTIONS.pageReleaseDelete,
      meta.idempotencyKey,
    );
    if (replay !== null) return ok(replay);

    const valid = await this.loadValidIntent(
      ACTIONS.pageReleaseDeletePlan,
      meta,
      input.confirmationToken,
    );
    if (!valid.ok) return err(valid.error);
    const { pageKey, releaseId, replacementReleaseId } = JSON.parse(valid.intent.targetId) as {
      pageKey: PageKey;
      releaseId: string;
      replacementReleaseId: string | null;
    };
    const impact = await this.buildPageReleaseImpact(pageKey, releaseId, replacementReleaseId);
    if (!impact) return err("deletion_plan_mismatch");
    if ((await sha256Hex(canonicalJson(impact))) !== valid.intent.impactHash) {
      return err("deletion_plan_mismatch");
    }

    const [entry] = await this.db
      .select({ id: pageEntry.id, activeReleaseId: pageEntry.activeReleaseId })
      .from(pageEntry)
      .where(eq(pageEntry.pageKey, pageKey))
      .limit(1);
    if (!entry) return err("deletion_plan_mismatch");

    const now = Date.now();
    const activeAffected = entry.activeReleaseId === releaseId;
    const statements: Stmt[] = [];
    let activeVersion: string | null;
    if (activeAffected) {
      statements.push(
        this.db
          .update(pageEntry)
          .set({ activeReleaseId: replacementReleaseId, updatedAt: now })
          .where(eq(pageEntry.id, entry.id)),
      );
      activeVersion =
        replacementReleaseId === null
          ? null
          : await this.releaseVersion(replacementReleaseId, "page");
    } else {
      activeVersion =
        entry.activeReleaseId === null
          ? null
          : await this.releaseVersion(entry.activeReleaseId, "page");
    }
    statements.push(
      this.db
        .delete(publisherReleaseMedia)
        .where(
          and(
            eq(publisherReleaseMedia.ownerType, "page"),
            eq(publisherReleaseMedia.releaseId, releaseId),
          ),
        ),
      this.db.delete(pageRelease).where(eq(pageRelease.id, releaseId)),
      this.consumeIntentStmt(valid.intent.tokenHash, now),
    );
    const value = { deleted: true as const, activeVersion };
    statements.push(
      this.eventStmt({
        action: ACTIONS.pageReleaseDelete,
        targetType: "page_release",
        targetId: releaseId,
        meta,
        value,
        now,
        detail: this.tombstone(impact),
      }),
    );
    return this.commit(ACTIONS.pageReleaseDelete, meta, statements, value);
  }

  // ── page aggregate deletion ────────────────────────────────────────────────────

  private async buildPageImpact(pageKey: PageKey): Promise<DeletionImpact | null> {
    const [entry] = await this.db
      .select({ id: pageEntry.id, activeReleaseId: pageEntry.activeReleaseId })
      .from(pageEntry)
      .where(eq(pageEntry.pageKey, pageKey))
      .limit(1);
    if (!entry) return null;

    const releaseIds = (
      await this.db
        .select({ id: pageRelease.id })
        .from(pageRelease)
        .where(eq(pageRelease.pageId, entry.id))
    ).map((r) => r.id);
    const releaseMedia = await this.releaseMediaCount("page", releaseIds);
    const media = await this.countRows(
      publisherMedia,
      and(eq(publisherMedia.ownerType, "page"), eq(publisherMedia.ownerId, entry.id)),
    );
    const warnings: string[] = [];
    if (entry.activeReleaseId !== null) {
      warnings.push(
        "This page is currently published; its public route will 404 until republished.",
      );
    }
    return {
      targetType: "page",
      targetId: entry.id,
      label: pageKey,
      activeReleaseAffected: entry.activeReleaseId !== null,
      deleteCounts: { releases: releaseIds.length, releaseMedia, media },
      retainedCounts: {},
      warnings,
    };
  }

  async planPageDeletion(
    call: OperatorCall<{ key: PageKey }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    const impact = await this.buildPageImpact(call.input.key);
    if (!impact) return err("not_found");
    const descriptor = JSON.stringify({ pageKey: call.input.key });
    return ok(await this.mintPlan(ACTIONS.pageDeletePlan, descriptor, impact, call.meta));
  }

  async deletePage(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    const { input, meta } = call;
    const replay = await this.replayed<{ deleted: true }>(ACTIONS.pageDelete, meta.idempotencyKey);
    if (replay !== null) return ok(replay);

    const valid = await this.loadValidIntent(ACTIONS.pageDeletePlan, meta, input.confirmationToken);
    if (!valid.ok) return err(valid.error);
    const { pageKey } = JSON.parse(valid.intent.targetId) as { pageKey: PageKey };
    const impact = await this.buildPageImpact(pageKey);
    if (!impact) return err("deletion_plan_mismatch");
    if ((await sha256Hex(canonicalJson(impact))) !== valid.intent.impactHash) {
      return err("deletion_plan_mismatch");
    }

    const [entry] = await this.db
      .select({ id: pageEntry.id })
      .from(pageEntry)
      .where(eq(pageEntry.pageKey, pageKey))
      .limit(1);
    if (!entry) return err("deletion_plan_mismatch");

    const now = Date.now();
    const pageId = entry.id;
    const storageKeys = (
      await this.db
        .select({ storageKey: publisherMedia.storageKey })
        .from(publisherMedia)
        .where(and(eq(publisherMedia.ownerType, "page"), eq(publisherMedia.ownerId, pageId)))
    ).map((r) => r.storageKey);
    const releaseIds = (
      await this.db
        .select({ id: pageRelease.id })
        .from(pageRelease)
        .where(eq(pageRelease.pageId, pageId))
    ).map((r) => r.id);

    const statements: Stmt[] = [
      this.db.update(pageEntry).set({ activeReleaseId: null }).where(eq(pageEntry.id, pageId)),
    ];
    if (releaseIds.length > 0) {
      statements.push(
        this.db
          .delete(publisherReleaseMedia)
          .where(
            and(
              eq(publisherReleaseMedia.ownerType, "page"),
              inArray(publisherReleaseMedia.releaseId, releaseIds),
            ),
          ),
      );
    }
    statements.push(
      this.db
        .delete(publisherMedia)
        .where(and(eq(publisherMedia.ownerType, "page"), eq(publisherMedia.ownerId, pageId))),
      this.db.delete(pageRelease).where(eq(pageRelease.pageId, pageId)),
      this.db.delete(pageDraft).where(eq(pageDraft.pageId, pageId)),
      this.db.delete(pageEntry).where(eq(pageEntry.id, pageId)),
      ...storageKeys.map((key) => this.gcOutboxStmt(key, now)),
      this.consumeIntentStmt(valid.intent.tokenHash, now),
    );
    const value = { deleted: true as const };
    statements.push(
      this.eventStmt({
        action: ACTIONS.pageDelete,
        targetType: "page",
        targetId: pageId,
        meta,
        value,
        now,
        detail: this.tombstone(impact),
      }),
    );
    return this.commit(ACTIONS.pageDelete, meta, statements, value);
  }

  // ── media deletion ─────────────────────────────────────────────────────────────

  private async buildMediaImpact(mediaId: string): Promise<DeletionImpact | null> {
    const [row] = await this.db
      .select({ alt: publisherMedia.alt })
      .from(publisherMedia)
      .where(eq(publisherMedia.id, mediaId))
      .limit(1);
    if (!row) return null;
    const activeRefs = await this.countActiveMediaRefs(mediaId);
    const releaseSnapshots = await this.countRows(
      publisherReleaseMedia,
      eq(publisherReleaseMedia.mediaId, mediaId),
    );
    const publicationSnapshots = await this.countRows(
      softwarePublicationMedia,
      eq(softwarePublicationMedia.mediaId, mediaId),
    );
    const warnings: string[] = [];
    if (activeRefs > 0) {
      warnings.push(
        `This media is shown by ${activeRefs} active release(s)/publication(s) and will be removed from them.`,
      );
    }
    return {
      targetType: "media",
      targetId: mediaId,
      label: row.alt.length > 0 ? row.alt : mediaId,
      activeReleaseAffected: activeRefs > 0,
      deleteCounts: { media: 1, releaseSnapshots, publicationSnapshots },
      retainedCounts: {},
      warnings,
    };
  }

  async planMediaDeletion(
    call: OperatorCall<{ mediaId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    const impact = await this.buildMediaImpact(call.input.mediaId);
    if (!impact) return err("not_found");
    const descriptor = JSON.stringify({ mediaId: call.input.mediaId });
    return ok(await this.mintPlan(ACTIONS.mediaDeletePlan, descriptor, impact, call.meta));
  }

  async deleteMedia(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    const { input, meta } = call;
    const replay = await this.replayed<{ deleted: true }>(ACTIONS.mediaDelete, meta.idempotencyKey);
    if (replay !== null) return ok(replay);

    const valid = await this.loadValidIntent(
      ACTIONS.mediaDeletePlan,
      meta,
      input.confirmationToken,
    );
    if (!valid.ok) return err(valid.error);
    const { mediaId } = JSON.parse(valid.intent.targetId) as { mediaId: string };
    const impact = await this.buildMediaImpact(mediaId);
    if (!impact) return err("deletion_plan_mismatch");
    if ((await sha256Hex(canonicalJson(impact))) !== valid.intent.impactHash) {
      return err("deletion_plan_mismatch");
    }

    const [row] = await this.db
      .select({ storageKey: publisherMedia.storageKey })
      .from(publisherMedia)
      .where(eq(publisherMedia.id, mediaId))
      .limit(1);
    if (!row) return err("deletion_plan_mismatch");

    const now = Date.now();
    const statements: Stmt[] = [
      this.db.delete(publisherReleaseMedia).where(eq(publisherReleaseMedia.mediaId, mediaId)),
      this.db.delete(softwarePublicationMedia).where(eq(softwarePublicationMedia.mediaId, mediaId)),
      // Text-column primary-media pointers carry no FK — null them so no draft or
      // publication is left naming a deleted media.
      this.db
        .update(softwarePublication)
        .set({ primaryMediaId: null })
        .where(eq(softwarePublication.primaryMediaId, mediaId)),
      this.db
        .update(softwareDraft)
        .set({ primaryMediaId: null })
        .where(eq(softwareDraft.primaryMediaId, mediaId)),
      this.db.delete(publisherMedia).where(eq(publisherMedia.id, mediaId)),
      this.gcOutboxStmt(row.storageKey, now),
      this.consumeIntentStmt(valid.intent.tokenHash, now),
    ];
    const value = { deleted: true as const };
    statements.push(
      this.eventStmt({
        action: ACTIONS.mediaDelete,
        targetType: "media",
        targetId: mediaId,
        meta,
        value,
        now,
        detail: this.tombstone(impact),
      }),
    );
    return this.commit(ACTIONS.mediaDelete, meta, statements, value);
  }
}
