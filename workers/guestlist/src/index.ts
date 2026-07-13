/**
 * si guestlist worker — the whole worker. All routing (better-auth HTTP)
 * plus the admin/org/user-directory/avatar RPC surface lives in the
 * package's WorkerEntrypoint; this shim wires si's config in and exports
 * the entrypoint class for the service binding.
 *
 * We subclass the package's `Guestlist` entrypoint to add one billing RPC
 * (`ensureStripeCustomer`) the pinned 0.0.5 package does not expose: it
 * carries no billing-customer surface at all. This method belongs upstream
 * in @somewhatintelligent/guestlist — delete this subclass and re-export
 * `gl.Guestlist` directly once upstream ships an equivalent RPC.
 */
import Stripe from "stripe";
import { createGuestlist } from "@somewhatintelligent/guestlist";
import { guestlistConfig } from "./config";
import { ensureStripeCustomerCore, type EnsureStripeCustomerResult } from "./stripe-customer";

const gl = createGuestlist(guestlistConfig);

// The endpoint (and this client) target Stripe API 2026-06-24.dahlia. Typed
// as a plain string so it narrows to the SDK's LatestApiVersion literal at
// construction — stripe@20.4.1's bundled type predates this version (same
// cast as workers/store/src/lib/stripe-webhook.ts / checkout.functions.ts).
const STRIPE_API_VERSION: string = "2026-06-24.dahlia";

export type { EnsureStripeCustomerResult } from "./stripe-customer";

export default { fetch: gl.fetch };

export class Guestlist extends gl.Guestlist {
  /**
   * Get-or-create the acting user's Stripe Customer and return its id.
   *
   * The acting user is resolved EXCLUSIVELY from the forwarded Cookie header
   * (never a caller-supplied userId — INV-9); the service binding is not a
   * trust boundary. Idempotent (INV-8): a persisted id is returned as-is, and
   * a first-time create carries `idempotencyKey: cust:<userId>` so a Worker
   * retry never double-creates. Stripe stays optional — the client is
   * constructed only past the secret-key gate, and any Stripe failure is a
   * `{ ok: false }` return, never a throw across the RPC boundary.
   *
   * Thin shell over ensureStripeCustomerCore (stripe-customer.ts); belongs
   * upstream in @somewhatintelligent/guestlist — delete when it ships there.
   */
  async ensureStripeCustomer(input: { cookie: string }): Promise<EnsureStripeCustomerResult> {
    const { session } = await this.getSession({ cookie: input.cookie });
    const secretKey = this.env.STRIPE_SECRET_KEY;
    return ensureStripeCustomerCore({
      db: this.env.DB,
      session,
      secretKey,
      // Constructed only past the core's secret-key gate (createCustomer is
      // never called when secretKey is absent), so keyless boot never reaches
      // `new Stripe(...)`.
      createCustomer: async ({ email, userId, idempotencyKey }) => {
        const stripe = new Stripe(secretKey as string, {
          apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
        });
        const customer = await stripe.customers.create(
          { email, metadata: { userId } },
          { idempotencyKey },
        );
        return customer.id;
      },
      // Voids this call's customer when another creator wins the NULL-gated
      // column claim (the column is the single arbiter of the one-customer-
      // per-user rule; Stripe-side idempotency keys cannot converge creators
      // that use different scopes, e.g. the better-auth plugin's signup-time
      // create).
      deleteCustomer: async (stripeCustomerId) => {
        const stripe = new Stripe(secretKey as string, {
          apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion,
        });
        await stripe.customers.del(stripeCustomerId);
      },
    });
  }
}
