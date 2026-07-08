/**
 * Shared "is Stripe wired up" gate: both the secret key and the webhook
 * signing secret must be present for any Stripe integration to turn on.
 *
 * This is the single home for the boolean that was duplicated inline across
 * workers/store and workers/guestlist. `packages/auth/src/server.ts`
 * DELIBERATELY keeps its own inline copy of the same check (near the
 * `stripeConfig?.secretKey && stripeConfig.webhookSecret` gate) — that module
 * carries zero `@si/*` runtime dependencies on purpose, so it mirrors this
 * predicate rather than importing it. `packages/stripe/__tests__/gate.test.ts`
 * asserts the two stay semantically identical.
 */
export function stripeConfigured(
  secretKey: string | undefined,
  webhookSecret: string | undefined,
): boolean {
  return Boolean(secretKey && webhookSecret);
}
