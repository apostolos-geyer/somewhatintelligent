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
 * in `./public/reads`. `PublisherOperator` remains a scaffold; the full mutation
 * surface lands in T16 (text + software), T17 (pages + validators), and T18
 * (deletion + media GC).
 */
import { WorkerEntrypoint } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";

import type {
  DomainResult,
  OperatorCall,
  PageKey,
  PublishedPageDTO,
  PublishedSoftwareDTO,
  PublishedSoftwareSummaryDTO,
  PublishedTextDTO,
  PublishedTextSummaryDTO,
  PublisherPublicEntrypoint,
} from "@si/contracts";

import type { PublisherEnv } from "./publisher-env";
import * as schema from "./schema";
import { createRoadieMediaStorage, PUBLISHER_MEDIA_APPLICATION } from "./lib/media-storage-roadie";
import { getRoadie } from "./lib/roadie";
import { PublisherPublicReads } from "./public/reads";

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
 * `operator_event` in the same D1 batch (INV-AUDIT-1).
 */
export class PublisherOperator extends WorkerEntrypoint<PublisherEnv> {
  async createText(
    _call: OperatorCall<{ slug: string; title: string }>,
  ): Promise<DomainResult<{ textId: string; revision: 1 }, "slug_taken">> {
    // TODO(T16): insert a text draft + one operator_event in a single D1 batch.
    throw new Error("PublisherOperator.createText not implemented (RFC-0001 T16)");
  }
}

/** Diagnostics-only fetch handler; Publisher has no public HTTP surface. */
export default {
  fetch(): Response {
    return new Response("publisher", { status: 200 });
  },
};
