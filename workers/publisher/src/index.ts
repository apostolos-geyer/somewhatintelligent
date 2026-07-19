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
 * in `./public/reads`. `PublisherOperator` (T16) is likewise a thin adapter over
 * `PublisherOperatorWrites` in `./operator/writes` for the text + software
 * lifecycles; pages land in T17 and deletion in T18 (their methods throw a clear
 * not-implemented until then).
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import type {
  ConfirmDeletionInput,
  DeletionError,
  DeletionPlan,
  DomainResult,
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
 * `operator_event` in the same D1 batch (INV-AUDIT-1). Text + software
 * lifecycles delegate to `PublisherOperatorWrites` (T16); page and deletion
 * methods throw until T17/T18.
 */
export class PublisherOperator
  extends WorkerEntrypoint<PublisherEnv>
  implements PublisherOperatorEntrypoint
{
  /** Mutation core over the live D1, gated on the `ENVIRONMENT` destination rule. */
  protected writes(): PublisherOperatorWrites {
    return new PublisherOperatorWrites({
      db: drizzle(this.env.DB, { schema }),
      environment: this.env.ENVIRONMENT,
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
    _call: OperatorCall<{ key: K }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "not_found">> {
    throw new Error("PublisherOperator.getPage not implemented (RFC-0001 T17)");
  }

  createPage<K extends PageKey>(
    _call: OperatorCall<{ key: K; document: PageDocumentByKey[K] }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "page_exists" | "invalid_document">> {
    throw new Error("PublisherOperator.createPage not implemented (RFC-0001 T17)");
  }

  savePageDraft<K extends PageKey>(
    _call: OperatorCall<{ key: K; expectedRevision: number; document: PageDocumentByKey[K] }>,
  ): Promise<
    DomainResult<
      { revision: number; updatedAt: number },
      "not_found" | "revision_conflict" | "invalid_document"
    >
  > {
    throw new Error("PublisherOperator.savePageDraft not implemented (RFC-0001 T17)");
  }

  publishPage(
    _call: OperatorCall<{ key: PageKey; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      "not_found" | "revision_conflict" | "invalid_version" | "version_exists" | "invalid_reference"
    >
  > {
    throw new Error("PublisherOperator.publishPage not implemented (RFC-0001 T17)");
  }

  // ── deletion + media GC (T18) ─────────────────────────────────────────────────

  planTextReleaseDeletion(
    _call: OperatorCall<{
      textId: string;
      releaseId: string;
      replacementReleaseId?: string | null;
    }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">> {
    throw new Error("PublisherOperator.planTextReleaseDeletion not implemented (RFC-0001 T18)");
  }

  deleteTextRelease(
    _call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>> {
    throw new Error("PublisherOperator.deleteTextRelease not implemented (RFC-0001 T18)");
  }

  planTextDeletion(
    _call: OperatorCall<{ textId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    throw new Error("PublisherOperator.planTextDeletion not implemented (RFC-0001 T18)");
  }

  deleteText(
    _call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    throw new Error("PublisherOperator.deleteText not implemented (RFC-0001 T18)");
  }

  planSoftwareDeletion(
    _call: OperatorCall<{ softwareId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    throw new Error("PublisherOperator.planSoftwareDeletion not implemented (RFC-0001 T18)");
  }

  deleteSoftware(
    _call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    throw new Error("PublisherOperator.deleteSoftware not implemented (RFC-0001 T18)");
  }

  planTagDeletion(
    _call: OperatorCall<{ tagId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    throw new Error("PublisherOperator.planTagDeletion not implemented (RFC-0001 T18)");
  }

  deleteTag(
    _call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    throw new Error("PublisherOperator.deleteTag not implemented (RFC-0001 T18)");
  }

  planPageReleaseDeletion(
    _call: OperatorCall<{ key: PageKey; releaseId: string; replacementReleaseId?: string | null }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">> {
    throw new Error("PublisherOperator.planPageReleaseDeletion not implemented (RFC-0001 T18)");
  }

  deletePageRelease(
    _call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>> {
    throw new Error("PublisherOperator.deletePageRelease not implemented (RFC-0001 T18)");
  }

  planPageDeletion(
    _call: OperatorCall<{ key: PageKey }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    throw new Error("PublisherOperator.planPageDeletion not implemented (RFC-0001 T18)");
  }

  deletePage(
    _call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    throw new Error("PublisherOperator.deletePage not implemented (RFC-0001 T18)");
  }

  planMediaDeletion(
    _call: OperatorCall<{ mediaId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">> {
    throw new Error("PublisherOperator.planMediaDeletion not implemented (RFC-0001 T18)");
  }

  deleteMedia(
    _call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>> {
    throw new Error("PublisherOperator.deleteMedia not implemented (RFC-0001 T18)");
  }
}

/** Diagnostics-only fetch handler; Publisher has no public HTTP surface. */
export default {
  fetch(): Response {
    return new Response("publisher", { status: 200 });
  },
};
