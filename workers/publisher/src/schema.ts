// Publisher D1 schema (RFC-0001 "Publisher D1"). Column names, constraints,
// FK actions, and indexes are the normative table contracts from the RFC —
// this file is the Drizzle transcription. All timestamps are unix milliseconds
// (`integer`, number-valued). Domain media IDs are distinct from storage keys:
// `storage_key` is the private MediaStorage port key and never appears in a DTO.
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// Closed value sets mirrored into SQL CHECK constraints. Kept local so the
// schema is self-contained; the page-key tuple matches `PageKey` in
// @si/contracts (asserted in the seed script that writes these rows).
const ENTRY_STATES = ["draft", "published", "retired"] as const;
const MEDIA_STATES = ["pending", "ready", "failed"] as const;
const MEDIA_OWNER_TYPES = ["text", "software", "page"] as const;
const RELEASE_MEDIA_OWNER_TYPES = ["text", "page"] as const;
const PAGE_KEYS = ["home", "shop", "writing", "software", "about"] as const;

// ── Texts ────────────────────────────────────────────────────────────────

// Identity + lifecycle for a text. `active_release_id` is set only after a
// release insert and cleared (SET NULL) if that release is deleted.
export const textEntry = sqliteTable(
  "text_entry",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    state: text("state", { enum: ENTRY_STATES }).notNull().default("draft"),
    // Explicit return-type annotation breaks the text_entry↔text_release
    // inference cycle (the FK points at a table declared below).
    activeReleaseId: text("active_release_id").references((): AnySQLiteColumn => textRelease.id, {
      onDelete: "set null",
    }),
    createdBySub: text("created_by_sub").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    retiredAt: integer("retired_at"),
  },
  (t) => [
    index("idx_text_entry_state_updated").on(t.state, sql`${t.updatedAt} desc`),
    check("text_entry_state_valid", sql`state IN ('draft', 'published', 'retired')`),
  ],
);

// Mutable working copy for a text (one row per entry). `revision` guards
// concurrent edits (INV via `expectedRevision`).
export const textDraft = sqliteTable(
  "text_draft",
  {
    textId: text("text_id")
      .primaryKey()
      .references(() => textEntry.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    title: text("title").notNull(),
    deck: text("deck"),
    bodyMarkdown: text("body_markdown").notNull().default(""),
    updatedBySub: text("updated_by_sub").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  () => [check("text_draft_revision_positive", sql`revision >= 1`)],
);

// Immutable published snapshot of a text at a SemVer. `UNIQUE(text_id, version)`
// forbids reusing a retained version until the release is explicitly deleted.
export const textRelease = sqliteTable(
  "text_release",
  {
    id: text("id").primaryKey(),
    textId: text("text_id")
      .notNull()
      .references(() => textEntry.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    deck: text("deck"),
    bodyMarkdown: text("body_markdown").notNull(),
    tagsJson: text("tags_json").notNull().default("[]"),
    publishedBySub: text("published_by_sub").notNull(),
    publishedAt: integer("published_at").notNull(),
  },
  (t) => [
    uniqueIndex("u_text_release_version").on(t.textId, t.version),
    index("idx_text_release_public").on(t.textId, sql`${t.publishedAt} desc`),
  ],
);

// ── Tags + links ───────────────────────────────────────────────────────────

export const tag = sqliteTable("tag", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  label: text("label").notNull(),
  createdAt: integer("created_at").notNull(),
});

// Text↔tag join (draft-time). Reverse index serves "texts for tag" lookups.
export const textTag = sqliteTable(
  "text_tag",
  {
    textId: text("text_id")
      .notNull()
      .references(() => textEntry.id, { onDelete: "cascade" }),
    tagId: text("tag_id")
      .notNull()
      .references(() => tag.id, { onDelete: "cascade" }),
  },
  (t) => [
    primaryKey({ columns: [t.textId, t.tagId] }),
    index("idx_text_tag_reverse").on(t.tagId, t.textId),
  ],
);

// Resolved wikilink from one text to another (or a dangling slug). `to_text_id`
// is SET NULL when the target text is deleted; `is_dangling` marks unresolved.
export const textLink = sqliteTable(
  "text_link",
  {
    id: text("id").primaryKey(),
    fromTextId: text("from_text_id")
      .notNull()
      .references(() => textEntry.id, { onDelete: "cascade" }),
    toTextId: text("to_text_id").references(() => textEntry.id, { onDelete: "set null" }),
    toSlug: text("to_slug").notNull(),
    isDangling: integer("is_dangling").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_text_link_from").on(t.fromTextId),
    index("idx_text_link_to").on(t.toTextId),
    check("text_link_dangling_bool", sql`is_dangling IN (0, 1)`),
  ],
);

// ── Software records ───────────────────────────────────────────────────────

// Identity + lifecycle for a software record. Unlike texts, software is
// unversioned: one draft and one published snapshot.
export const softwareEntry = sqliteTable(
  "software_entry",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    state: text("state", { enum: ENTRY_STATES }).notNull().default("draft"),
    createdBySub: text("created_by_sub").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    retiredAt: integer("retired_at"),
  },
  (t) => [
    index("idx_software_entry_state_updated").on(t.state, sql`${t.updatedAt} desc`),
    check("software_entry_state_valid", sql`state IN ('draft', 'published', 'retired')`),
  ],
);

export const softwareDraft = sqliteTable(
  "software_draft",
  {
    softwareId: text("software_id")
      .primaryKey()
      .references(() => softwareEntry.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    title: text("title").notNull(),
    deck: text("deck").notNull().default(""),
    whatItIsMarkdown: text("what_it_is_markdown").notNull().default(""),
    destinationUrl: text("destination_url").notNull().default(""),
    actionLabel: text("action_label").notNull().default("Open system"),
    primaryMediaId: text("primary_media_id"),
    updatedBySub: text("updated_by_sub").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  () => [check("software_draft_revision_positive", sql`revision >= 1`)],
);

// The single public snapshot for a software record. Upserted on publish;
// `published_at` is set on first publish, `updated_at` on every publish (the
// public "Last updated").
export const softwarePublication = sqliteTable("software_publication", {
  softwareId: text("software_id")
    .primaryKey()
    .references(() => softwareEntry.id, { onDelete: "cascade" }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  deck: text("deck").notNull(),
  whatItIsMarkdown: text("what_it_is_markdown").notNull(),
  destinationUrl: text("destination_url").notNull(),
  actionLabel: text("action_label").notNull(),
  primaryMediaId: text("primary_media_id"),
  publishedBySub: text("published_by_sub").notNull(),
  publishedAt: integer("published_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ── Media ──────────────────────────────────────────────────────────────────

// Domain media identity + metadata + eligibility. `storage_key` is the private
// port key (never a DTO field). Media becomes public only via a release/
// publication snapshot join below.
export const publisherMedia = sqliteTable(
  "publisher_media",
  {
    id: text("id").primaryKey(),
    ownerType: text("owner_type", { enum: MEDIA_OWNER_TYPES }).notNull(),
    ownerId: text("owner_id").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    contentSha256: text("content_sha256").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    width: integer("width"),
    height: integer("height"),
    role: text("role").notNull(),
    alt: text("alt").notNull(),
    position: integer("position").notNull().default(0),
    state: text("state", { enum: MEDIA_STATES }).notNull().default("pending"),
    createdBySub: text("created_by_sub").notNull(),
    createdAt: integer("created_at").notNull(),
    readyAt: integer("ready_at"),
  },
  (t) => [
    index("idx_publisher_media_owner").on(t.ownerType, t.ownerId, t.position),
    check("publisher_media_owner_type_valid", sql`owner_type IN ('text', 'software', 'page')`),
    check("publisher_media_size_non_negative", sql`size_bytes >= 0`),
    check("publisher_media_state_valid", sql`state IN ('pending', 'ready', 'failed')`),
  ],
);

// Immutable media snapshot bound to a text/page release. `release_id` is a
// generic release identifier (not a single-table FK) keyed by `owner_type`.
export const publisherReleaseMedia = sqliteTable(
  "publisher_release_media",
  {
    ownerType: text("owner_type", { enum: RELEASE_MEDIA_OWNER_TYPES }).notNull(),
    releaseId: text("release_id").notNull(),
    mediaId: text("media_id")
      .notNull()
      .references(() => publisherMedia.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    alt: text("alt").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ownerType, t.releaseId, t.mediaId] }),
    index("idx_publisher_release_media_lookup").on(t.mediaId, t.ownerType, t.releaseId),
    check("publisher_release_media_owner_type_valid", sql`owner_type IN ('text', 'page')`),
  ],
);

// Media snapshot bound to the single software publication.
export const softwarePublicationMedia = sqliteTable(
  "software_publication_media",
  {
    softwareId: text("software_id")
      .notNull()
      .references(() => softwarePublication.softwareId, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references(() => publisherMedia.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    alt: text("alt").notNull(),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.softwareId, t.mediaId] }),
    index("idx_software_publication_media_lookup").on(t.mediaId, t.softwareId),
  ],
);

// ── Fixed pages ────────────────────────────────────────────────────────────

// One of the five fixed pages. `page_key` is closed to the five keys; the
// active pointer is SET NULL when its release is deleted.
export const pageEntry = sqliteTable(
  "page_entry",
  {
    id: text("id").primaryKey(),
    pageKey: text("page_key", { enum: PAGE_KEYS }).notNull().unique(),
    // Explicit return-type annotation breaks the page_entry↔page_release
    // inference cycle (the FK points at a table declared below).
    activeReleaseId: text("active_release_id").references((): AnySQLiteColumn => pageRelease.id, {
      onDelete: "set null",
    }),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    check(
      "page_entry_key_valid",
      sql`page_key IN ('home', 'shop', 'writing', 'software', 'about')`,
    ),
  ],
);

// Mutable page document (versioned discriminated-union JSON) for a page entry.
export const pageDraft = sqliteTable(
  "page_draft",
  {
    pageId: text("page_id")
      .primaryKey()
      .references(() => pageEntry.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull().default(1),
    schemaVersion: integer("schema_version").notNull().default(1),
    documentJson: text("document_json").notNull(),
    updatedBySub: text("updated_by_sub").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  () => [check("page_draft_revision_positive", sql`revision >= 1`)],
);

// Immutable published page document. `UNIQUE(page_id, version)` forbids reusing
// a retained version until explicitly deleted.
export const pageRelease = sqliteTable(
  "page_release",
  {
    id: text("id").primaryKey(),
    pageId: text("page_id")
      .notNull()
      .references(() => pageEntry.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    documentJson: text("document_json").notNull(),
    publishedBySub: text("published_by_sub").notNull(),
    publishedAt: integer("published_at").notNull(),
  },
  (t) => [uniqueIndex("u_page_release_version").on(t.pageId, t.version)],
);

// ── Operator audit + deletion + media GC ─────────────────────────────────────

// Append-only operator audit log (INV-AUDIT-1). One row per successful
// operator mutation. `UNIQUE(idempotency_key, action)` makes a replayed command
// return the prior `response_json` instead of mutating twice. Sensitive bodies
// and blob bytes are never copied here.
export const operatorEvent = sqliteTable(
  "operator_event",
  {
    id: text("id").primaryKey(),
    operatorSub: text("operator_sub").notNull(),
    operatorEmail: text("operator_email").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    requestId: text("request_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    outcome: text("outcome").notNull(),
    detailJson: text("detail_json"),
    responseJson: text("response_json"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("u_operator_event_key").on(t.idempotencyKey, t.action),
    index("idx_publisher_event_target").on(t.targetType, t.targetId, sql`${t.createdAt} desc`),
  ],
);

// Short-lived hard-delete authorization. A plan mints a `token_hash` bound to an
// `impact_hash`; confirm consumes it iff the impact still matches.
export const operatorDeletionIntent = sqliteTable("operator_deletion_intent", {
  tokenHash: text("token_hash").primaryKey(),
  operatorSub: text("operator_sub").notNull(),
  action: text("action").notNull(),
  targetId: text("target_id").notNull(),
  impactHash: text("impact_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  consumedAt: integer("consumed_at"),
});

// Durable queue of storage keys awaiting physical byte cleanup. A row survives
// failed async deletes; a retry sweep drains it (INV-DEL-4).
export const mediaGcOutbox = sqliteTable("media_gc_outbox", {
  id: text("id").primaryKey(),
  storageKey: text("storage_key").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: integer("next_attempt_at").notNull(),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
});

// ── Row types ───────────────────────────────────────────────────────────────

export type TextEntryRow = typeof textEntry.$inferSelect;
export type TextDraftRow = typeof textDraft.$inferSelect;
export type TextReleaseRow = typeof textRelease.$inferSelect;
export type TagRow = typeof tag.$inferSelect;
export type TextTagRow = typeof textTag.$inferSelect;
export type TextLinkRow = typeof textLink.$inferSelect;
export type SoftwareEntryRow = typeof softwareEntry.$inferSelect;
export type SoftwareDraftRow = typeof softwareDraft.$inferSelect;
export type SoftwarePublicationRow = typeof softwarePublication.$inferSelect;
export type PublisherMediaRow = typeof publisherMedia.$inferSelect;
export type PublisherReleaseMediaRow = typeof publisherReleaseMedia.$inferSelect;
export type SoftwarePublicationMediaRow = typeof softwarePublicationMedia.$inferSelect;
export type PageEntryRow = typeof pageEntry.$inferSelect;
export type PageDraftRow = typeof pageDraft.$inferSelect;
export type PageReleaseRow = typeof pageRelease.$inferSelect;
export type OperatorEventRow = typeof operatorEvent.$inferSelect;
export type OperatorDeletionIntentRow = typeof operatorDeletionIntent.$inferSelect;
export type MediaGcOutboxRow = typeof mediaGcOutbox.$inferSelect;
