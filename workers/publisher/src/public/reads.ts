/**
 * PublisherPublic read core (RFC-0001 "PublisherPublic RPC", D3/D4/D9/D9.1).
 * The Site-bound entrypoint in `../index.ts` is a thin adapter over this class;
 * separating it lets the D1 pool suite drive the reads with a real local D1 and
 * an injected {@link MediaStorage} stub, no ROADIE binding required.
 *
 * INV-PUB-1: every read resolves ONLY through an active release pointer
 * (`text_entry.active_release_id` / `page_entry.active_release_id`) or a
 * published `software_publication`. There is no draft method, so drafts and
 * retired records are unreachable — a retired text is filtered out by its entry
 * state, a retired software by its entry state, an unpublished page by a null
 * active pointer.
 *
 * INV-MEDIA-1: `openPublishedMedia` streams bytes only for a media id that a
 * public snapshot references (a text/page release-media row of an active
 * release, or a publication-media row of a published software record); every
 * draft-only or unrelated id is `not_found`.
 *
 * INV-PAGE-1: `getPage` re-validates `document_json` through the @si/contracts
 * page validators at the read boundary, so a corrupt or tampered release can
 * never emit an invalid document — it is treated as `not_found` and logged.
 */
import { type SQL, and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";

import { err, ok } from "@si/contracts/result";
import { validatePageDocument } from "@si/contracts";
import type {
  DomainResult,
  PageKey,
  PublicMediaRef,
  PublishedPageDTO,
  PublishedSoftwareDTO,
  PublishedSoftwareSummaryDTO,
  PublishedTextDTO,
  PublishedTextSummaryDTO,
  PublisherPublicEntrypoint,
} from "@si/contracts";

import type { MediaStorage } from "../lib/media-storage";
import * as schema from "../schema";
import { clampLimit, decodeCursor, encodeCursor } from "./cursor";

const {
  textEntry,
  textRelease,
  softwareEntry,
  softwarePublication,
  pageEntry,
  pageRelease,
  publisherMedia,
  publisherReleaseMedia,
  softwarePublicationMedia,
} = schema;

export type PublisherDb = DrizzleD1Database<typeof schema>;

export interface PublisherReadsDeps {
  db: PublisherDb;
  media: MediaStorage;
}

// Selected once so listTexts and getTextBySlug read identical row shapes.
const textRowColumns = {
  entryId: textEntry.id,
  releaseId: textRelease.id,
  slug: textRelease.slug,
  version: textRelease.version,
  title: textRelease.title,
  deck: textRelease.deck,
  bodyMarkdown: textRelease.bodyMarkdown,
  tagsJson: textRelease.tagsJson,
  publishedAt: textRelease.publishedAt,
};

const softwareRowColumns = {
  softwareId: softwarePublication.softwareId,
  slug: softwarePublication.slug,
  title: softwarePublication.title,
  deck: softwarePublication.deck,
  whatItIsMarkdown: softwarePublication.whatItIsMarkdown,
  destinationUrl: softwarePublication.destinationUrl,
  actionLabel: softwarePublication.actionLabel,
  primaryMediaId: softwarePublication.primaryMediaId,
  updatedAt: softwarePublication.updatedAt,
};

const EXCERPT_MAX = 240;

/** Derive a plain-text summary excerpt from a release body's markdown. */
function deriveExcerpt(bodyMarkdown: string): string {
  const plain = bodyMarkdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= EXCERPT_MAX) return plain;
  const clipped = plain.slice(0, EXCERPT_MAX);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.trimEnd()}…`;
}

/** Parse a release's snapshot `tags_json`, tolerating a malformed value. */
function parseTags(tagsJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(tagsJson);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
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

/** Map a snapshot media row to a storage-neutral {@link PublicMediaRef}. */
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

export class PublisherPublicReads implements PublisherPublicEntrypoint {
  private readonly db: PublisherDb;
  private readonly media: MediaStorage;

  constructor(deps: PublisherReadsDeps) {
    this.db = deps.db;
    this.media = deps.media;
  }

  async listTexts(input: {
    tag?: string;
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<{ texts: PublishedTextSummaryDTO[]; nextCursor: string | null }, "invalid_cursor">
  > {
    const limit = clampLimit(input.limit);
    const conditions: SQL[] = [eq(textEntry.state, "published")];
    if (typeof input.tag === "string" && input.tag.length > 0) {
      conditions.push(sql`${textRelease.tagsJson} LIKE ${`%"${input.tag}"%`}`);
    }
    if (input.cursor !== undefined) {
      const after = decodeCursor(input.cursor);
      if (after === null) return err("invalid_cursor");
      const keyset = or(
        lt(textRelease.publishedAt, after.ts),
        and(eq(textRelease.publishedAt, after.ts), lt(textEntry.id, after.id)),
      );
      if (keyset) conditions.push(keyset);
    }

    const rows = await this.db
      .select(textRowColumns)
      .from(textRelease)
      .innerJoin(textEntry, eq(textEntry.activeReleaseId, textRelease.id))
      .where(and(...conditions))
      .orderBy(desc(textRelease.publishedAt), desc(textEntry.id))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const mediaByRelease = await this.loadTextReleaseMedia(page.map((r) => r.releaseId));
    const texts = page.map((r) => this.toTextSummary(r, mediaByRelease.get(r.releaseId) ?? []));
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last ? encodeCursor({ ts: last.publishedAt, id: last.entryId }) : null;
    return ok({ texts, nextCursor });
  }

  async getTextBySlug(input: {
    slug: string;
  }): Promise<DomainResult<PublishedTextDTO, "not_found">> {
    const [row] = await this.db
      .select(textRowColumns)
      .from(textRelease)
      .innerJoin(textEntry, eq(textEntry.activeReleaseId, textRelease.id))
      .where(and(eq(textEntry.state, "published"), eq(textRelease.slug, input.slug)))
      .limit(1);
    if (!row) return err("not_found");
    const media = (await this.loadTextReleaseMedia([row.releaseId])).get(row.releaseId) ?? [];
    return ok({
      ...this.toTextSummary(row, media),
      bodyMarkdown: row.bodyMarkdown,
      media,
    });
  }

  async listSoftware(input: {
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<
      { software: PublishedSoftwareSummaryDTO[]; nextCursor: string | null },
      "invalid_cursor"
    >
  > {
    const limit = clampLimit(input.limit);
    const conditions: SQL[] = [eq(softwareEntry.state, "published")];
    if (input.cursor !== undefined) {
      const after = decodeCursor(input.cursor);
      if (after === null) return err("invalid_cursor");
      const keyset = or(
        lt(softwarePublication.updatedAt, after.ts),
        and(
          eq(softwarePublication.updatedAt, after.ts),
          lt(softwarePublication.softwareId, after.id),
        ),
      );
      if (keyset) conditions.push(keyset);
    }

    const rows = await this.db
      .select(softwareRowColumns)
      .from(softwarePublication)
      .innerJoin(softwareEntry, eq(softwareEntry.id, softwarePublication.softwareId))
      .where(and(...conditions))
      .orderBy(desc(softwarePublication.updatedAt), desc(softwarePublication.softwareId))
      .limit(limit + 1);

    const page = rows.slice(0, limit);
    const mediaBySoftware = await this.loadSoftwareMedia(page.map((r) => r.softwareId));
    const software = page.map((r) =>
      this.toSoftwareSummary(r, mediaBySoftware.get(r.softwareId) ?? []),
    );
    const last = page.at(-1);
    const nextCursor =
      rows.length > limit && last
        ? encodeCursor({ ts: last.updatedAt, id: last.softwareId })
        : null;
    return ok({ software, nextCursor });
  }

  async getSoftwareBySlug(input: {
    slug: string;
  }): Promise<DomainResult<PublishedSoftwareDTO, "not_found">> {
    const [row] = await this.db
      .select(softwareRowColumns)
      .from(softwarePublication)
      .innerJoin(softwareEntry, eq(softwareEntry.id, softwarePublication.softwareId))
      .where(and(eq(softwareEntry.state, "published"), eq(softwarePublication.slug, input.slug)))
      .limit(1);
    if (!row) return err("not_found");
    const media = (await this.loadSoftwareMedia([row.softwareId])).get(row.softwareId) ?? [];
    return ok({
      ...this.toSoftwareSummary(row, media),
      whatItIsMarkdown: row.whatItIsMarkdown,
      destinationUrl: row.destinationUrl,
      actionLabel: row.actionLabel,
      media,
    });
  }

  async getPage<K extends PageKey>(input: {
    key: K;
  }): Promise<DomainResult<PublishedPageDTO<K>, "not_found">> {
    const [row] = await this.db
      .select({
        version: pageRelease.version,
        documentJson: pageRelease.documentJson,
        publishedAt: pageRelease.publishedAt,
      })
      .from(pageEntry)
      .innerJoin(pageRelease, eq(pageRelease.id, pageEntry.activeReleaseId))
      .where(eq(pageEntry.pageKey, input.key))
      .limit(1);
    if (!row) return err("not_found");

    let raw: unknown;
    try {
      raw = JSON.parse(row.documentJson);
    } catch {
      console.error("publisher: active page release has non-JSON document", { key: input.key });
      return err("not_found");
    }
    const validated = validatePageDocument(input.key, raw);
    if (!validated.ok) {
      console.error("publisher: active page release failed document validation", {
        key: input.key,
        reason: validated.message,
      });
      return err("not_found");
    }
    return ok({
      key: input.key,
      version: row.version,
      document: validated.value,
      publishedAt: row.publishedAt,
    });
  }

  async openPublishedMedia(input: {
    mediaId: string;
  }): Promise<DomainResult<Response, "not_found">> {
    const [row] = await this.db
      .select({ storageKey: publisherMedia.storageKey })
      .from(publisherMedia)
      .where(eq(publisherMedia.id, input.mediaId))
      .limit(1);
    if (!row) return err("not_found");
    if (!(await this.isMediaEligible(input.mediaId))) return err("not_found");

    const read = await this.media.read({ key: row.storageKey });
    if (!read.ok) return err("not_found");
    return ok(read.value);
  }

  // A media id is public iff it is snapshotted by the active release of a
  // published text or page, or by a published software record (INV-MEDIA-1).
  private async isMediaEligible(mediaId: string): Promise<boolean> {
    const textHit = await this.db
      .select({ one: sql<number>`1` })
      .from(publisherReleaseMedia)
      .innerJoin(textEntry, eq(textEntry.activeReleaseId, publisherReleaseMedia.releaseId))
      .where(
        and(
          eq(publisherReleaseMedia.mediaId, mediaId),
          eq(publisherReleaseMedia.ownerType, "text"),
          eq(textEntry.state, "published"),
        ),
      )
      .limit(1);
    if (textHit.length > 0) return true;

    const pageHit = await this.db
      .select({ one: sql<number>`1` })
      .from(publisherReleaseMedia)
      .innerJoin(pageEntry, eq(pageEntry.activeReleaseId, publisherReleaseMedia.releaseId))
      .where(
        and(
          eq(publisherReleaseMedia.mediaId, mediaId),
          eq(publisherReleaseMedia.ownerType, "page"),
        ),
      )
      .limit(1);
    if (pageHit.length > 0) return true;

    const softwareHit = await this.db
      .select({ one: sql<number>`1` })
      .from(softwarePublicationMedia)
      .innerJoin(softwareEntry, eq(softwareEntry.id, softwarePublicationMedia.softwareId))
      .where(
        and(eq(softwarePublicationMedia.mediaId, mediaId), eq(softwareEntry.state, "published")),
      )
      .limit(1);
    return softwareHit.length > 0;
  }

  private toTextSummary(
    row: {
      entryId: string;
      slug: string;
      version: string;
      title: string;
      deck: string | null;
      bodyMarkdown: string;
      tagsJson: string;
      publishedAt: number;
    },
    media: PublicMediaRef[],
  ): PublishedTextSummaryDTO {
    return {
      id: row.entryId,
      slug: row.slug,
      version: row.version,
      title: row.title,
      deck: row.deck,
      excerpt: deriveExcerpt(row.bodyMarkdown),
      publishedAt: row.publishedAt,
      tags: parseTags(row.tagsJson),
      // The lead media (lowest position) doubles as the summary hero.
      heroMedia: media[0] ?? null,
    };
  }

  private toSoftwareSummary(
    row: {
      softwareId: string;
      slug: string;
      title: string;
      deck: string;
      primaryMediaId: string | null;
      updatedAt: number;
    },
    media: PublicMediaRef[],
  ): PublishedSoftwareSummaryDTO {
    // Software designates its primary image explicitly; honor that pointer
    // (only when the target is itself snapshotted), never an arbitrary fallback.
    const primaryMedia =
      row.primaryMediaId !== null ? (media.find((m) => m.id === row.primaryMediaId) ?? null) : null;
    return {
      id: row.softwareId,
      slug: row.slug,
      title: row.title,
      deck: row.deck,
      primaryMedia,
      updatedAt: row.updatedAt,
    };
  }

  // Snapshot media for a set of text/page releases, grouped and ordered.
  private async loadTextReleaseMedia(releaseIds: string[]): Promise<Map<string, PublicMediaRef[]>> {
    const grouped = new Map<string, PublicMediaRef[]>();
    if (releaseIds.length === 0) return grouped;
    const rows = await this.db
      .select({
        releaseId: publisherReleaseMedia.releaseId,
        mediaId: publisherReleaseMedia.mediaId,
        role: publisherReleaseMedia.role,
        alt: publisherReleaseMedia.alt,
        position: publisherReleaseMedia.position,
        contentType: publisherMedia.contentType,
        width: publisherMedia.width,
        height: publisherMedia.height,
      })
      .from(publisherReleaseMedia)
      .innerJoin(publisherMedia, eq(publisherMedia.id, publisherReleaseMedia.mediaId))
      .where(
        and(
          eq(publisherReleaseMedia.ownerType, "text"),
          inArray(publisherReleaseMedia.releaseId, releaseIds),
        ),
      )
      .orderBy(asc(publisherReleaseMedia.position), asc(publisherReleaseMedia.mediaId));
    for (const row of rows) {
      const list = grouped.get(row.releaseId) ?? [];
      list.push(toMediaRef(row));
      grouped.set(row.releaseId, list);
    }
    return grouped;
  }

  // Snapshot media for a set of software publications, grouped and ordered.
  private async loadSoftwareMedia(softwareIds: string[]): Promise<Map<string, PublicMediaRef[]>> {
    const grouped = new Map<string, PublicMediaRef[]>();
    if (softwareIds.length === 0) return grouped;
    const rows = await this.db
      .select({
        softwareId: softwarePublicationMedia.softwareId,
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
      .where(inArray(softwarePublicationMedia.softwareId, softwareIds))
      .orderBy(asc(softwarePublicationMedia.position), asc(softwarePublicationMedia.mediaId));
    for (const row of rows) {
      const list = grouped.get(row.softwareId) ?? [];
      list.push(toMediaRef(row));
      grouped.set(row.softwareId, list);
    }
    return grouped;
  }
}
