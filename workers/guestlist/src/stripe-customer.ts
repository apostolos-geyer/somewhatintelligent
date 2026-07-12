/**
 * Get-or-create decision core for the `ensureStripeCustomer` billing RPC,
 * extracted from the entrypoint shell (index.ts) so the D1 read/write path is
 * exercisable against a real D1 with the Stripe customer-create injected — the
 * same injectable-core split store uses for checkout (lib/checkout.ts). The
 * Stripe client is constructed only in the shell, past the secret-key gate, so
 * this module carries no Stripe runtime dependency.
 *
 * Belongs upstream in @somewhatintelligent/guestlist; it lives here only
 * because the pinned 0.0.5 package exposes no billing-customer surface.
 */
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { user } from "./schema.gen";

export type EnsureStripeCustomerResult =
  | { ok: true; stripeCustomerId: string }
  | { ok: false; error: "unauthorized" | "stripe_unconfigured" | "stripe_customer_create_failed" };

// Creates the Stripe Customer and returns its id. The idempotency key is
// derived by the core (INV-8) and passed through so the injected implementation
// forwards it verbatim to Stripe — keeping key derivation in the testable core.
export type CustomerCreator = (input: {
  email: string;
  userId: string;
  idempotencyKey: string;
}) => Promise<string>;

export interface EnsureStripeCustomerDeps {
  db: D1Database;
  // Resolved exclusively from the forwarded session cookie (INV-9); null when
  // the cookie carries no valid session.
  session: PlatformSession | null;
  // Present iff STRIPE_SECRET_KEY is set. Customer creation needs only the
  // secret key — the webhook secret gates signature verification, which this
  // operation never performs, so it is deliberately not required here.
  secretKey: string | undefined;
  createCustomer: CustomerCreator;
}

/**
 * Ordering: authorize (cookie session) → gate on the secret key → return a
 * persisted id if one exists → else create (idempotency-keyed) and persist.
 * Never throws: a Stripe failure is a `{ ok: false }` return.
 */
export async function ensureStripeCustomerCore(
  deps: EnsureStripeCustomerDeps,
): Promise<EnsureStripeCustomerResult> {
  if (!deps.session) return { ok: false, error: "unauthorized" };
  if (!deps.secretKey) return { ok: false, error: "stripe_unconfigured" };

  const userId = deps.session.user.id;
  const db = drizzle(deps.db);

  const [row] = await db
    .select({ stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (row?.stripeCustomerId) return { ok: true, stripeCustomerId: row.stripeCustomerId };

  let stripeCustomerId: string;
  try {
    stripeCustomerId = await deps.createCustomer({
      email: deps.session.user.email,
      userId,
      idempotencyKey: `cust:${userId}`,
    });
  } catch (err) {
    console.error(
      `[guestlist] customers.create failed for user ${userId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return { ok: false, error: "stripe_customer_create_failed" };
  }

  await db.update(user).set({ stripeCustomerId }).where(eq(user.id, userId));
  return { ok: true, stripeCustomerId };
}
