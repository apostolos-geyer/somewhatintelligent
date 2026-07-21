/**
 * Server-side PublisherPublic read client (RFC-0001 D4/D9/D9.1, INV-SITE-1).
 * Site binds `PUBLISHER` with entrypoint `PublisherPublic`; the generated Env
 * types it as a bare `Service`, so the frozen `@si/contracts` interface is
 * asserted here — the one place that cast lives. Read-only: the public surface
 * cannot return drafts or invoke any mutation (INV-PUB-1).
 *
 * `Astro.locals.runtime.env` was removed in Astro v6+ / `@astrojs/cloudflare`
 * v14, so the binding is read from `cloudflare:workers` `env`, lazily at request
 * time — mirroring `store-catalog.ts`.
 */
import { env } from "cloudflare:workers";
import type {
  DomainResult,
  PageKey,
  PublishedPageDTO,
  PublishedSoftwareDTO,
  PublishedSoftwareSummaryDTO,
  PublishedTextDTO,
  PublishedTextSummaryDTO,
  PublisherPublicEntrypoint,
} from "@si/contracts";

export type {
  PageKey,
  PublicMediaRef,
  PublishedPageDTO,
  PublishedSoftwareDTO,
  PublishedSoftwareSummaryDTO,
  PublishedTextDTO,
  PublishedTextSummaryDTO,
} from "@si/contracts";

// Pure display helpers live in ./format so they stay free of the
// `cloudflare:workers` binding; re-exported here for server pages.
export { publisherMediaHref } from "./format";

/** The PUBLISHER service binding, typed to the read-only public contract. */
function publisher(): PublisherPublicEntrypoint {
  return env.PUBLISHER as unknown as PublisherPublicEntrypoint;
}

/** A keyset page of published text summaries (newest-published first). An
 *  optional `tag` filters to texts carrying that tag. */
export function listTexts(
  input: { tag?: string; limit?: number; cursor?: string } = {},
): Promise<
  DomainResult<{ texts: PublishedTextSummaryDTO[]; nextCursor: string | null }, "invalid_cursor">
> {
  return publisher().listTexts(input);
}

/** The active-release full text for a slug, or a typed `not_found`. */
export function getTextBySlug(slug: string): Promise<DomainResult<PublishedTextDTO, "not_found">> {
  return publisher().getTextBySlug({ slug });
}

/** A keyset page of published software summaries (newest-updated first). */
export function listSoftware(
  input: { limit?: number; cursor?: string } = {},
): Promise<
  DomainResult<
    { software: PublishedSoftwareSummaryDTO[]; nextCursor: string | null },
    "invalid_cursor"
  >
> {
  return publisher().listSoftware(input);
}

/** The published software detail for a slug, or a typed `not_found`. */
export function getSoftwareBySlug(
  slug: string,
): Promise<DomainResult<PublishedSoftwareDTO, "not_found">> {
  return publisher().getSoftwareBySlug({ slug });
}

/** The re-validated active page document for a key, or a typed `not_found`
 *  (INV-PAGE-1: Publisher re-validates at the read boundary). */
export function getPage<K extends PageKey>(
  key: K,
): Promise<DomainResult<PublishedPageDTO<K>, "not_found">> {
  return publisher().getPage({ key });
}

/** Stream the bytes of a published media id, or a typed `not_found`
 *  (INV-MEDIA-1). Returns a `Response` to pass straight through. */
export function openPublishedMedia(mediaId: string): Promise<DomainResult<Response, "not_found">> {
  return publisher().openPublishedMedia({ mediaId });
}
