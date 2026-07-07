/**
 * Envelope-driven request middleware. Verifies the bouncer attestation
 * locally (Ed25519, no I/O, no guestlist RPC) and projects the result onto
 * the TSS request context as `ctx.principal`. The single trust source for
 * downstream handlers — see `docs/REQUEST-FLOW.md` §4 + §8.
 *
 * Verification is zero-hop: no per-request guestlist RPC. Mutations that
 * need plugin-extended BA fields still call `getSession` explicitly at the
 * callsite (§9.0.1).
 */
import { createMiddleware } from "@tanstack/react-start";
import {
  EnvelopeRejection,
  type BouncerEnvelopeVerifier,
  type EnvelopeActorUser,
  type EnvelopeResult,
  type EnvelopeSessionData,
} from "@si/auth";
import { updateRequestContext } from "../request-context";

/**
 * Discriminated principal projection of the verified envelope. Today's active
 * variants are `user` and `anonymous`; future kinds (service, webhook) slot
 * in without breaking exhaustive consumers — they branch on `kind`.
 */
export type Principal =
  | {
      kind: "user";
      actor: EnvelopeActorUser;
      session: EnvelopeSessionData;
      activeOrgId: string | null;
    }
  | { kind: "anonymous" };

export interface EnvelopeMiddlewareOpts {
  /**
   * Returns the bouncer envelope verifier. Called lazily on first request so
   * apps can defer env-access (cloudflare's `env` global is server-only).
   * The returned verifier is cached internally for the isolate's lifetime.
   */
  getVerifier: () => BouncerEnvelopeVerifier;
}

/**
 * Build the global envelope middleware. Apps install this in
 * `start.ts`'s `requestMiddleware` chain and pass the same singleton
 * reference into `createPrincipalGate`s so TSS dedupes the verify step.
 */
export function createEnvelopeMiddleware(opts: EnvelopeMiddlewareOpts) {
  let cached: BouncerEnvelopeVerifier | null = null;
  function verifier(): BouncerEnvelopeVerifier {
    if (!cached) cached = opts.getVerifier();
    return cached;
  }
  return createMiddleware({ type: "request" }).server(async ({ next, request }) => {
    let result: EnvelopeResult;
    try {
      result = await verifier()(request);
    } catch (err) {
      if (err instanceof EnvelopeRejection) {
        throw new Response(`Forbidden: ${err.reason}`, {
          status: 403,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      throw err;
    }
    const principal = projectPrincipal(result);
    if (principal.kind === "user") {
      updateRequestContext({ actorKind: "user", actorId: principal.actor.id });
    }
    return next({ context: { principal } });
  });
}

function projectPrincipal(result: EnvelopeResult): Principal {
  if (result.kind !== "valid") return { kind: "anonymous" };
  if (!result.actor || !result.session) return { kind: "anonymous" };
  if (result.actor.kind === "user") {
    return {
      kind: "user",
      actor: result.actor,
      session: result.session,
      activeOrgId: result.activeOrgId,
    };
  }
  // Forward-compat: unknown actor kinds collapse to anonymous until we add
  // a Principal variant for them. Verifier already rejected service actors
  // since bouncer doesn't mint them yet.
  return { kind: "anonymous" };
}

export interface PrincipalGateOpts<P extends Principal> {
  /**
   * The singleton envelope middleware instance the app installed globally.
   * Used as a `.middleware([...])` dependency so TSS's `flattenMiddlewares`
   * dedupes the verify step — see `@tanstack/start-client-core`'s
   * `createServerFn.js:147` and `createStartHandler.js:358`.
   */
  envelope: ReturnType<typeof createEnvelopeMiddleware>;
  /**
   * Type-guard predicate. Narrows `context.principal` to `P` for downstream
   * handlers so they can read `principal.actor.id` etc. without re-checking
   * `kind`. Example for "must be a user":
   *
   *   predicate: (p): p is Extract<Principal, { kind: "user" }> => p.kind === "user"
   */
  predicate: (principal: Principal) => principal is P;
  /**
   * Called on predicate failure. Default throws `Error("forbidden")`. Apps
   * typically throw a redirect or a custom Response for cloaking.
   */
  onReject?: () => never;
}

/**
 * Build a gate middleware on top of `envelopeMiddleware`. Composing by
 * reference means TSS only runs envelope-verify once per request even when
 * multiple gates are attached. The narrowed `principal` flows down the
 * chain so handlers attached via `.middleware([gate])` see the gated
 * variant directly.
 */
export function createPrincipalGate<P extends Principal>(opts: PrincipalGateOpts<P>) {
  const reject =
    opts.onReject ??
    (() => {
      throw new Error("forbidden");
    });
  return createMiddleware({ type: "request" })
    .middleware([opts.envelope])
    .server(async ({ next, context }) => {
      if (!opts.predicate(context.principal)) reject();
      return next({ context: { principal: context.principal as P } });
    });
}
