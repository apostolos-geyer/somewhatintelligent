import type { DomainResult } from "./result";
import type { PublicMediaRef } from "./media";
import type { PageDocumentByKey, PageKey } from "./pages";

/**
 * `PublisherPublic` — the read-only RPC surface bound only to Site (RFC-0001
 * "PublisherPublic RPC" / D4, D9, D9.1). It cannot return drafts. Public
 * text/page reads return only active immutable releases; public software reads
 * return only published snapshots (INV-PUB-1).
 */
export interface PublishedTextSummaryDTO {
  id: string;
  slug: string;
  version: string;
  title: string;
  deck: string | null;
  excerpt: string;
  publishedAt: number;
  tags: string[];
  heroMedia: PublicMediaRef | null;
}

export interface PublishedTextDTO extends PublishedTextSummaryDTO {
  bodyMarkdown: string;
  media: PublicMediaRef[];
}

export interface PublishedSoftwareSummaryDTO {
  id: string;
  slug: string;
  title: string;
  deck: string;
  primaryMedia: PublicMediaRef | null;
  updatedAt: number;
}

export interface PublishedSoftwareDTO extends PublishedSoftwareSummaryDTO {
  whatItIsMarkdown: string;
  destinationUrl: string;
  actionLabel: string;
  media: PublicMediaRef[];
}

export interface PublishedPageDTO<K extends PageKey = PageKey> {
  key: K;
  version: string;
  document: PageDocumentByKey[K];
  publishedAt: number;
}

export interface PublisherPublicEntrypoint {
  listTexts(input: {
    tag?: string;
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<{ texts: PublishedTextSummaryDTO[]; nextCursor: string | null }, "invalid_cursor">
  >;

  getTextBySlug(input: { slug: string }): Promise<DomainResult<PublishedTextDTO, "not_found">>;

  listSoftware(input: {
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<
      { software: PublishedSoftwareSummaryDTO[]; nextCursor: string | null },
      "invalid_cursor"
    >
  >;

  getSoftwareBySlug(input: {
    slug: string;
  }): Promise<DomainResult<PublishedSoftwareDTO, "not_found">>;

  getPage<K extends PageKey>(input: {
    key: K;
  }): Promise<DomainResult<PublishedPageDTO<K>, "not_found">>;

  openPublishedMedia(input: { mediaId: string }): Promise<DomainResult<Response, "not_found">>;
}
