/**
 * Server-side PublisherOperator mutation client (RFC-0001 D8). Operator binds
 * `PUBLISHER` with entrypoint `PublisherOperator`; the generated Env types it as
 * a bare `Service`, so the frozen `@si/contracts` interface is asserted here —
 * the one place that cast lives. Cross-worker RPC types never auto-resolve for a
 * TanStack Start target, so the interface is asserted, not imported by class.
 *
 * Every method takes an `OperatorCall<T>` envelope: the caller supplies the
 * domain `input` and the server-derived `OperatorMeta` (from `buildOperatorMeta`).
 */
import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import type { PublisherOperatorEntrypoint } from "@si/contracts";

export type {
  TextDraftDTO,
  SoftwareDraftDTO,
  PageDraftDTO,
  PublisherMediaDTO,
  PageKey,
  PageDocumentByKey,
} from "@si/contracts";

/** The PUBLISHER service binding, typed to the operator-mutation contract. */
export const publisherOperator = createServerOnlyFn(
  function publisherOperator(): PublisherOperatorEntrypoint {
    return env.PUBLISHER as unknown as PublisherOperatorEntrypoint;
  },
);
