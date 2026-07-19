/**
 * Publisher worker — texts, software records, and fixed pages (RFC-0001 D2).
 *
 * Two RPC entrypoints share one D1: `PublisherPublic` is bound only to Site and
 * is read-only (it cannot return drafts, INV-PUB-1); `PublisherOperator` is
 * bound only to Operator and owns every mutation. The service binding is the
 * machine-authorization boundary — neither entrypoint is exposed over public
 * HTTP.
 *
 * SCAFFOLD (exec-plan 0004 track T14). The classes expose a representative
 * slice of their contract so the worker builds, imports @si/contracts, and
 * declares the dual-entrypoint RPC shape. The full entrypoints land in T15
 * (public reads), T16 (text + software), T17 (pages + validators), and T18
 * (deletion + media GC).
 */
import { WorkerEntrypoint } from "cloudflare:workers";

import { err, ok } from "@si/contracts/result";
import type {
  DomainResult,
  OperatorCall,
  PageKey,
  PublishedPageDTO,
  PublishedTextSummaryDTO,
} from "@si/contracts";

import type { PublisherEnv } from "./publisher-env";

/**
 * `PublisherPublic` — Site-bound, read-only (RFC-0001 "PublisherPublic RPC").
 * Returns only active immutable releases and published software snapshots.
 */
export class PublisherPublic extends WorkerEntrypoint<PublisherEnv> {
  async getPage<K extends PageKey>(_input: {
    key: K;
  }): Promise<DomainResult<PublishedPageDTO<K>, "not_found">> {
    // TODO(T15): read the active page release for `key` from D1.
    return err("not_found", "publisher not yet implemented");
  }

  async listTexts(_input: {
    tag?: string;
    limit?: number;
    cursor?: string;
  }): Promise<
    DomainResult<{ texts: PublishedTextSummaryDTO[]; nextCursor: string | null }, "invalid_cursor">
  > {
    // TODO(T15): list published text summaries from active release pointers.
    return ok({ texts: [], nextCursor: null });
  }

  async openPublishedMedia(_input: {
    mediaId: string;
  }): Promise<DomainResult<Response, "not_found">> {
    // TODO(T15 + T5): confirm the media is snapshotted by a public release, then
    // stream it through the private MediaStorage port.
    return err("not_found");
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
