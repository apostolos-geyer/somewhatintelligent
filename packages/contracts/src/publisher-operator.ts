import type { DomainResult } from "./result";
import type { OperatorCall } from "./operator";
import type { ConfirmDeletionInput, DeletionError, DeletionPlan } from "./deletion";
import type { PublisherMediaDTO } from "./media";
import type { PageDocumentByKey, PageKey } from "./pages";
import type { PublishedSoftwareDTO } from "./publisher-public";

/**
 * `PublisherOperator` — the operator-mutation RPC surface bound only to Operator
 * (RFC-0001 "PublisherOperator RPC" / D8, D9, D9.1, D13). Draft saves use
 * optimistic concurrency (`expectedRevision`) so two browser tabs cannot
 * silently overwrite one another. Software destination URLs must use `https:`
 * in deployed environments; Publisher treats the destination as inert authored
 * data and never fetches or follows it.
 */
export interface TextDraftDTO {
  textId: string;
  slug: string;
  revision: number;
  title: string;
  deck: string | null;
  bodyMarkdown: string;
  tags: string[];
  activeVersion: string | null;
  state: "draft" | "published" | "retired";
  updatedAt: number;
}

export interface SoftwareDraftDTO {
  softwareId: string;
  slug: string;
  revision: number;
  title: string;
  deck: string;
  whatItIsMarkdown: string;
  destinationUrl: string;
  actionLabel: string;
  primaryMediaId: string | null;
  state: "draft" | "published" | "retired";
  publishedUpdatedAt: number | null;
  updatedAt: number;
}

export interface PageDraftDTO<K extends PageKey = PageKey> {
  pageId: string;
  key: K;
  revision: number;
  document: PageDocumentByKey[K];
  activeVersion: string | null;
  updatedAt: number;
  media: PublisherMediaDTO[];
}

export interface PublisherOperatorEntrypoint {
  listTexts(
    call: OperatorCall<{
      state?: "draft" | "published" | "retired" | "all";
      limit?: number;
      cursor?: string;
    }>,
  ): Promise<DomainResult<{ texts: TextDraftDTO[]; nextCursor: string | null }, "invalid_cursor">>;

  getText(call: OperatorCall<{ textId: string }>): Promise<
    DomainResult<
      {
        draft: TextDraftDTO;
        releases: Array<{ id: string; version: string; publishedAt: number }>;
        media: PublisherMediaDTO[];
      },
      "not_found"
    >
  >;

  createText(
    call: OperatorCall<{ slug: string; title: string }>,
  ): Promise<DomainResult<{ textId: string; revision: 1 }, "slug_taken">>;

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
  >;

  publishText(
    call: OperatorCall<{ textId: string; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      "not_found" | "revision_conflict" | "invalid_version" | "version_exists"
    >
  >;

  retireText(
    call: OperatorCall<{ textId: string }>,
  ): Promise<DomainResult<{ state: "retired" }, "not_found">>;

  planTextReleaseDeletion(
    call: OperatorCall<{
      textId: string;
      releaseId: string;
      replacementReleaseId?: string | null;
    }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">>;
  deleteTextRelease(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>>;

  planTextDeletion(
    call: OperatorCall<{ textId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deleteText(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>>;

  listSoftware(
    call: OperatorCall<{
      state?: "draft" | "published" | "retired" | "all";
      limit?: number;
      cursor?: string;
    }>,
  ): Promise<
    DomainResult<{ software: SoftwareDraftDTO[]; nextCursor: string | null }, "invalid_cursor">
  >;

  getSoftware(call: OperatorCall<{ softwareId: string }>): Promise<
    DomainResult<
      {
        draft: SoftwareDraftDTO;
        published: PublishedSoftwareDTO | null;
        media: PublisherMediaDTO[];
      },
      "not_found"
    >
  >;

  createSoftware(
    call: OperatorCall<{ slug: string; title: string }>,
  ): Promise<DomainResult<{ softwareId: string; revision: 1 }, "slug_taken">>;

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
  >;

  publishSoftware(
    call: OperatorCall<{ softwareId: string; expectedRevision: number }>,
  ): Promise<
    DomainResult<
      { publishedAt: number; updatedAt: number },
      "not_found" | "revision_conflict" | "invalid_destination" | "missing_media"
    >
  >;

  retireSoftware(
    call: OperatorCall<{ softwareId: string }>,
  ): Promise<DomainResult<{ state: "retired" }, "not_found">>;

  planSoftwareDeletion(
    call: OperatorCall<{ softwareId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deleteSoftware(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>>;

  planTagDeletion(
    call: OperatorCall<{ tagId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deleteTag(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>>;

  getPage<K extends PageKey>(
    call: OperatorCall<{ key: K }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "not_found">>;

  createPage<K extends PageKey>(
    call: OperatorCall<{ key: K; document: PageDocumentByKey[K] }>,
  ): Promise<DomainResult<PageDraftDTO<K>, "page_exists" | "invalid_document">>;

  savePageDraft<K extends PageKey>(
    call: OperatorCall<{ key: K; expectedRevision: number; document: PageDocumentByKey[K] }>,
  ): Promise<
    DomainResult<
      { revision: number; updatedAt: number },
      "not_found" | "revision_conflict" | "invalid_document"
    >
  >;

  publishPage(
    call: OperatorCall<{ key: PageKey; expectedRevision: number; version: string }>,
  ): Promise<
    DomainResult<
      { releaseId: string; version: string; publishedAt: number },
      "not_found" | "revision_conflict" | "invalid_version" | "version_exists" | "invalid_reference"
    >
  >;

  planPageReleaseDeletion(
    call: OperatorCall<{
      key: PageKey;
      releaseId: string;
      replacementReleaseId?: string | null;
    }>,
  ): Promise<DomainResult<DeletionPlan, "not_found" | "invalid_replacement">>;
  deletePageRelease(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true; activeVersion: string | null }, DeletionError>>;

  planPageDeletion(
    call: OperatorCall<{ key: PageKey }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deletePage(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>>;

  planMediaDeletion(
    call: OperatorCall<{ mediaId: string }>,
  ): Promise<DomainResult<DeletionPlan, "not_found">>;
  deleteMedia(
    call: OperatorCall<ConfirmDeletionInput>,
  ): Promise<DomainResult<{ deleted: true }, DeletionError>>;
}
