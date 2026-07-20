/**
 * Publisher worker — texts, software records, and fixed pages (RFC-0001 D2).
 *
 * Two RPC entrypoints share one D1: `PublisherPublic` is bound only to Site and
 * is read-only (it cannot return drafts, INV-PUB-1); `PublisherOperator` is
 * bound only to Operator and owns every mutation. The service binding is the
 * machine-authorization boundary — neither entrypoint is exposed over public
 * HTTP.
 *
 * `PublisherPublic` (T15) is a thin adapter: it constructs the D1 handle and the
 * Roadie-backed MediaStorage adapter, then delegates to `PublisherPublicReads`
 * in `./public/reads`. `PublisherOperator` is likewise a thin adapter over
 * `PublisherOperatorWrites` in `./operator/writes` for the text + software
 * lifecycles (T16) and the page lifecycle (T17, whose publish gates references
 * through the `StoreCatalog` binding); the two-step hard-delete + media GC
 * lifecycle lands in T18. The default export's `scheduled` cron drains the
 * media GC outbox.
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import type {
  ConfirmDeletionInput,
  DeletionError,
  DeletionPlan,
  DomainResult,
  MediaMutationError,
  OperatorCall,
  PageDocumentByKey,
  PageDraftDTO,
  PageKey,
  PublishedPageDTO,
  PublishedSoftwareDTO,
  PublishedSoftwareSummaryDTO,
  PublishedTextDTO,
  PublishedTextSummaryDTO,
  PublisherMediaDTO,
  PublisherOperatorEntrypoint,
  PublisherPublicEntrypoint,
  SoftwareDraftDTO,
  TextDraftDTO,
} from "@si/contracts";

import type { PublisherEnv } from "./publisher-env";
import * as schema from "./schema";
import { createRoadieMediaStorage, PUBLISHER_MEDIA_APPLICATION } from "./lib/media-storage-roadie";
import { getRoadie } from "./lib/roadie";
import { PublisherPublicReads } from "./public/reads";
import { PublisherOperatorWrites } from "./operator/writes";

/**
 * `PublisherPublic` — Site-bound, read-only (RFC-0001 "PublisherPublic RPC").
 * Returns only active immutable releases and published software snapshots.
 */
export class PublisherPublic
  extends WorkerEntrypoint<PublisherEnv>
  implements PublisherPublicEntrypoint
{
  /** Read core over the live D1 + the Roadie-backed MediaStorage port. */
  protected reads(): PublisherPublicReads {
    return new PublisherPublicReads({
      db: drizzle(this.env.DB, { schema }),
      media: createRoadieMediaStorage(getRoadie(this.env), {
        application: PUBLISHER_MEDIA_APPLICATION,
      }),
    });
  }

  listTexts(input: {
    tag?: string;
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<{ texts: PublishedTextSummaryDTO[]; nextCursor: string | null }, "invalid_cursor">
  > {
    return this.reads().listTexts(input);
  }

  getTextBySlug(input: { slug: string }): Promise<DomainResult<PublishedTextDTO, "not_found">> {
    return this.reads().getTextBySlug(input);
  }

  listSoftware(input: {
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<
      { software: PublishedSoftwareSummaryDTO[]; nextCursor: string | null },
      "invalid_cursor"
    >
  > {
    return this.reads().listSoftware(input);
  }

  getSoftwareBySlug(input: {
    slug: string;
  }): Promise<DomainResult<PublishedSoftwareDTO, "not_found">> {
    return this.reads().getSoftwareBySlug(input);
  }

  getPage<K extends PageKey>(input: {
    key: K;
  }): Promise<DomainResult<PublishedPageDTO<K>, "not_found">> {
    return this.reads().getPage(input);
  }

  openPublishedMedia(input: { mediaId: string }): Promise<DomainResult<Response, "not_found">> {
    return this.reads().openPublishedMedia(input);
  }
}

/**
 * `PublisherOperator` — Operator-bound, mutation (RFC-0001 "PublisherOperator
 * RPC"). Each success produces exactly one domain mutation and one
 * `operator_event` in the same D1 batch (INV-AUDIT-1). Text + software (T16),
 * page (T17), and hard-delete (T18) lifecycles all delegate to
 * `PublisherOperatorWrites`.
 */
export class PublisherOperator
  extends WorkerEntrypoint<PublisherEnv>
  implements PublisherOperatorEntrypoint
{
  /** Mutation core over the live D1, gated on the `ENVIRONMENT` destination rule
   *  and the read-only `StoreCatalog` binding used for page-reference validation. */
  protected writes(): PublisherOperatorWrites {
    return new PublisherOperatorWrites({
      db: drizzle(this.env.DB, { schema }),
      environment: this.env.ENVIRONMENT,
      storeCatalog: this.env.STORE,
    });
  }

  // ── texts (T16) ─────────────────────────────────────────────────────────────

  listTexts(
    call: OperatorCall<{
      state?: "draft" | "published" | "retired" | "all";
      limit?: number;
      cursor?: string;
    }>,
  ): Promise<DomainResult<{ texts: TextDraftDTO[]; nextCursor: string | null }, "invalid_cursor">> {
    return this.writes().listTexts(call);
  }

  getText(call: OperatorCall<{ textId: string }>): Promise<
    DomainResult<
      {
        draft: TextDraftDTO;
        releases: Array<{ id: string; version: string; publishedAt: number }>;
        media: PublisherMediaDTO[];
      },
      "not_found"
    >
  > {
    return this.writes().getText(call);
  }

  createText(
    call: OperatorCall<{ slug: string; title: string }>,
  ): Promise<DomainResult<{ textId: string; revision: 1 }, "slug_taken">> {
    return this.writes().createText(call);
  }

  saveTextDraft(
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
    return this.writes().saveTextDraft(call);
  }

  publishText(
    call: OperatorCall<{ textId: string; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      "not_found" | "revision_conflict" | "invalid_version" | "version_exists"
    >
  > {
    return this.writes().publishText(call);
  }

  retireText(
    call: OperatorCall<{ textId: string }>,
  ): Promise<DomainResult<{ state: "retired" }, "not_found">> {
    return this.writes().retireText(call);
  }

  // ── software (T16) ──────────────────────────────────────────────────────────

  listSoftware(
    call: OperatorCall<{
      state?: "draft" | "published" | "retired" | "all";
      limit?: number;
      cursor?: string;
    }>,
  ): Promise<
    DomainResult<{ software: SoftwareDraftDTO[]; nextCursor: string | null }, "invalid_cursor">
  > {
    return this.writes().listSoftware(call);
  }

  getSoftware(call: OperatorCall<{ softwareId: string }>): Promise<
    DomainResult<
      {
        draft: SoftwareDraftDTO;
        published: PublishedSoftwareDTO | null;
        media: PublisherMediaDTO[];
      },
      "not_found"
    >
  > {
    return this.writes().getSoftware(call);
  }

  createSoftware(
    call: OperatorCall<{ slug: string; title: string }>,
  ): Promise<DomainResult<{ softwareId: string; revision: 1 }, "slug_taken">> {
    return this.writes().createSoftware(call);
  }

  saveSoftwareDraft(
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
    return this.writes().saveSoftwareDraft(call);
  }

  publishSoftware(
    call: OperatorCall<{ softwareId: string; expectedRevision: number }>,
  ): Promise<
    DomainResult<
      { publishedAt: number; updatedAt: number },
      "not_found" | "revision_conflict" | "invalid_destination" | "missing_media"
    >
  > {
    return this.writes().publishSoftware(call);
  }

  retireSoftware(
    call: OperatorCall<{ softwareId: string }>,
  ): Promise<DomainResult<{ state: "retired" }, "not_found">> {
    return this.writes().retireSoftware(call);
  }

  // ── pages (T17) ─────────────────────────────────────────────────────────────

  getPage<K extends PageKey>(
    call: OperatorCall<{ key: K }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "not_found">> {
    return this.writes().getPage(call);
  }

  createPage<K extends PageKey>(
    call: OperatorCall<{ key: K; document: PageDocumentByKey[K] }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "page_exists" | "invalid_document">> {
    return this.writes().createPage(call);
  }

  savePageDraft<K extends PageKey>(
    call: OperatorCall<{ key: K; expectedRevision: number; document: PageDocumentByKey[K] }>,
  ): Promise<
    DomainResult<
      { revision: number; updatedAt: number },
      "not_found" | "revision_conflict" | "invalid_document"
    >
  > {
    return this.writes().savePageDraft(call);
  }

  publishPage(
    call: OperatorCall<{ key: PageKey; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      "not_found" | "revision_conflict" | "invalid_version" | "version_exists" | "invalid_reference"
    >
  > {
    return this.writes().publishPage(call);
  }

  // ── media ingest (T19) ────────────────────────────────────────────────────────

  // Private, Operator-only media ingest (RFC-0001 D10). NOT part of the frozen
  // `PublisherOperatorEntrypoint` contract — reached only over the
  // Operator→Publisher service binding. Builds the Roadie-backed MediaStorage
  // port and delegates to the pool-testable writes core.
  ingestMedia(input: {
    ownerType: "text" | "software" | "page";
    ownerId: string;
    body: ReadableStream<Uint8Array>;
    contentType: string;
    size: number;
    sha256: string;
    alt: string;
    role: string;
    createdBySub: string;
  }): Promise<DomainResult<PublisherMediaDTO, MediaMutationError>> {
    const media = createRoadieMediaStorage(getRoadie(this.env), {
      application: PUBLISHER_MEDIA_APPLICATION,
    });
    return this.writes().ingestMedia(input, media);
  }

  // ── deletion + media GC (T18) ─────────────────────────────────────────────────

  planTextReleaseDeletion(
    call: OperatorCall<{
      textId: string;
      releaseId: string;
      replacementReleaseId?: string | null;
    }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">> {
    return this.writes().planTextReleaseDeletion(call);
  }

  deleteTextRelease(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>> {
    return this.writes().deleteTextRelease(call);
  }

  planTextDeletion(
    call: OperatorCall<{ textId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    return this.writes().planTextDeletion(call);
  }

  deleteText(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    return this.writes().deleteText(call);
  }

  planSoftwareDeletion(
    call: OperatorCall<{ softwareId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    return this.writes().planSoftwareDeletion(call);
  }

  deleteSoftware(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    return this.writes().deleteSoftware(call);
  }

  planTagDeletion(
    call: OperatorCall<{ tagId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    return this.writes().planTagDeletion(call);
  }

  deleteTag(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    return this.writes().deleteTag(call);
  }

  planPageReleaseDeletion(
    call: OperatorCall<{ key: PageKey; releaseId: string; replacementReleaseId?: string | null }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">> {
    return this.writes().planPageReleaseDeletion(call);
  }

  deletePageRelease(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>> {
    return this.writes().deletePageRelease(call);
  }

  planPageDeletion(
    call: OperatorCall<{ key: PageKey }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    return this.writes().planPageDeletion(call);
  }

  deletePage(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    return this.writes().deletePage(call);
  }

  planMediaDeletion(
    call: OperatorCall<{ mediaId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    return this.writes().planMediaDeletion(call);
  }

  deleteMedia(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    return this.writes().deleteMedia(call);
  }
}

/**
 * Diagnostics-only fetch handler (Publisher has no public HTTP surface) plus the
 * media GC cron. The scheduled sweep drains `media_gc_outbox` — the durable queue
 * of storage keys a hard delete logically removed — through the Roadie-backed
 * MediaStorage port (RFC-0001 D10, INV-DEL-4). The drain + adapter are resolved
 * by lazy dynamic import so the RPC entrypoints never pay for the GC path.
 */
export default {
  fetch(): Response {
    return new Response("publisher", { status: 200 });
  },
  async scheduled(_controller: ScheduledController, env: PublisherEnv): Promise<void> {
    const { drainMediaGc } = await import("./lib/media-gc");
    const storage = createRoadieMediaStorage(getRoadie(env), {
      application: PUBLISHER_MEDIA_APPLICATION,
    });
    await drainMediaGc({ db: drizzle(env.DB, { schema }), storage });
  },
};
