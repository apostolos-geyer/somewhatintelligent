/**
 * PublisherOperator mutation core (RFC-0001 "PublisherOperator RPC", D8/D9.1/D13)
 * for texts and software records (exec-plan 0004 T16). The Operator-bound
 * entrypoint in `../index.ts` is a thin adapter over this class; separating it
 * lets the D1 pool suite drive every mutation against a real local D1 with no
 * ROADIE binding — the writes need only D1 and the `ENVIRONMENT` string.
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
 */
import { type SQL, and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { err, ok } from "@si/contracts/result";
import { isValidVersion } from "@si/contracts";
import type {
  DomainResult,
  OperatorCall,
  OperatorMeta,
  PublicMediaRef,
  PublishedSoftwareDTO,
  PublisherMediaDTO,
  SoftwareDraftDTO,
  TextDraftDTO,
} from "@si/contracts";

import type { PublisherDb } from "../public/reads";
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
  operatorEvent,
} = schema;

type Stmt = BatchItem<"sqlite">;

export interface PublisherOperatorWritesDeps {
  db: PublisherDb;
  /** Cloudflare `ENVIRONMENT` var; gates loopback `http:` software destinations. */
  environment: string;
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
} as const;

const ACTION_LABEL_MAX = 40;
const DEFAULT_ACTION_LABEL = "Open system";
const WIKILINK_RE = /\[\[([^[\]]+)\]\]/g;

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

export class PublisherOperatorWrites {
  private readonly db: PublisherDb;
  private readonly environment: string;

  constructor(deps: PublisherOperatorWritesDeps) {
    this.db = deps.db;
    this.environment = deps.environment;
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
      detailJson: null,
      responseJson: JSON.stringify(p.value),
      createdAt: p.now,
    });
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
}
