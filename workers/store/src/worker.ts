// Hand-written entry; do not wrap in a kit factory. Mirrors
// workers/identity/src/worker.ts (docs/ARCHITECTURE.md §3.3 + §4.4).
import startEntry from "@tanstack/react-start/server-entry";
import { requestHandler } from "@tanstack/react-start/server";
import { extractPlatformStartContext } from "@somewhatintelligent/kit/react-start";
import { runWithExecutionContext } from "@somewhatintelligent/kit/execution-context";
import { stripeConfigured } from "@somewhatintelligent/stripe";
import { makeStripeClient } from "./lib/stripe-client";
import { devEnvelopeStamper } from "./lib/platform";
import storeApi from "./api/store-api";
import { createDb } from "./lib/db";
import { consumeStripeEventBatch, DLQ_QUEUE_PATTERN, processDlqBatch } from "./lib/stripe-queue";
import { reconcilePendingReservations } from "./lib/reconcile";
import { extractSessionSnapshot } from "./lib/stripe-session-fields";
import type { StoreStripeEventMessage } from "./lib/stripe-webhook";

// Named RPC entrypoints resolved by exported class name (RFC-0001 "Worker
// bindings"). Site's STORE binding uses `entrypoint: "StoreCatalog"` (read-only);
// Operator's STORE binding uses `entrypoint: "StoreOperator"` (mutation). Both
// re-export from the worker's main module so wrangler resolves them.
export { StoreCatalog } from "./store-catalog";
export { StoreOperator } from "./store-operator";

declare module "@tanstack/react-start" {
  interface Register {
    server: { requestContext: { requestId: string; callerApp?: string } };
  }
}

// Append the dev envelope stamper's Set-Cookie headers without disturbing the
// response body (dev-direct only — the stamper is a hard no-op in staging/prod).
function appendSetCookies(response: Response, setCookies: string[]): Response {
  if (setCookies.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const sc of setCookies) headers.append("set-cookie", sc);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // The public Store HTTP API (/api/store/*, RFC-0001 D11/T12) and the Stripe
    // webhook (/hooks/store/stripe) are answered by the Hono app ahead of SSR.
    // Buyer resolution runs getSession against the bouncer envelope, which
    // enriches through a guestlist RPC that reads request cookies from the
    // TanStack Start request ALS — requestHandler establishes it here exactly as
    // startEntry.fetch does for SSR, and the dev stamper self-mints the envelope
    // dev-direct. Every other path (including the doomed admin/public routes)
    // falls through to SSR unchanged.
    if (url.pathname.startsWith("/api/store") || url.pathname.startsWith("/hooks/store")) {
      return runWithExecutionContext(ctx, async () => {
        const { request: stamped, setCookies } = devEnvelopeStamper
          ? await devEnvelopeStamper(request)
          : { request, setCookies: [] as string[] };
        // requestHandler wraps the dispatch in the TanStack Start request ALS
        // (h3 event) so getSession's guestlist enrichment can read cookies; its
        // returned fn takes a second `requestOpts` the Hono handler never reads.
        const response = await requestHandler((req: Request) => storeApi.fetch(req, env, ctx))(
          stamped,
          undefined,
        );
        return appendSetCookies(response, setCookies);
      });
    }

    return runWithExecutionContext(ctx, async () => {
      // Dev-direct stamper mints an attestation envelope from the session cookie
      // so the principal (and the admin gate / admin server fns) resolves without
      // a bouncer in front. Hard no-op outside dev — see ARCHITECTURE.md §4.5.
      const { request: stamped, setCookies } = devEnvelopeStamper
        ? await devEnvelopeStamper(request)
        : { request, setCookies: [] as string[] };

      const response = await startEntry.fetch(stamped, {
        context: extractPlatformStartContext(stamped),
      });
      return appendSetCookies(response, setCookies);
    });
  },
  async queue(batch: MessageBatch<StoreStripeEventMessage>, env: Env): Promise<void> {
    const db = createDb(env.DB);
    if (DLQ_QUEUE_PATTERN.test(batch.queue)) {
      await processDlqBatch(db, batch, env);
      return;
    }
    await consumeStripeEventBatch(db, batch, env);
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    // Only one cron is registered (wrangler.jsonc) — the sweep runs
    // unconditionally on every trigger. INV-7 decoupling: the sweep only ever
    // acts on Stripe-path reservations (which require a resolved customer id,
    // never set without Stripe) and needs a live client to re-check
    // stale-attached sessions. With Stripe unconfigured there is nothing to
    // sweep and no client to build — skip.
    if (!stripeConfigured(env.STRIPE_SECRET_KEY, env.STRIPE_WEBHOOK_SIGNING_SECRET)) return;
    const stripe = makeStripeClient(env.STRIPE_SECRET_KEY);
    await reconcilePendingReservations({
      db: createDb(env.DB),
      retrieveSession: async (sessionId) => {
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        return { status: s.status, payment_status: s.payment_status, ...extractSessionSnapshot(s) };
      },
      expireSession: async (sessionId) => {
        await stripe.checkout.sessions.expire(sessionId);
      },
    });
  },
} satisfies ExportedHandler<Env, StoreStripeEventMessage>;
