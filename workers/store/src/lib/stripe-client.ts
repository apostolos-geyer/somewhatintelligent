// Single source of truth for this worker's pinned Stripe API version and
// client construction. stripe@20.4.1's bundled types predate this version, so
// the literal is typed as a plain string and narrowed to LatestApiVersion at
// construction.
import Stripe from "stripe";

const STRIPE_API_VERSION: string = "2026-06-24.dahlia";

export function makeStripeClient(secretKey: string): Stripe {
  return new Stripe(secretKey, { apiVersion: STRIPE_API_VERSION as Stripe.LatestApiVersion });
}
