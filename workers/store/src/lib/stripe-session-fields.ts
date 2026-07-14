// Defensive extraction of the shipping snapshot + finalized money a paid Stripe
// checkout session carries, plus the order-column backfill built from it. No
// Stripe SDK import — both the webhook producer (from event.data.object) and the
// reconcile sweep (from a full sessions.retrieve response) pass their object in,
// and the queue consumer + heal path spread the backfill straight into a drizzle
// `.set()`. Kept SDK-free so reconcile.ts stays drivable without a Stripe client.

// The Stripe-collected shipping address, flattened. `state`/`postal` mirror
// Stripe's `address.state`/`address.postal_code`.
export type StripeShippingDetails = {
  name?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postal?: string;
  country?: string;
  phone?: string;
};

// The subset of a completed session both the producer and the sweep carry
// forward: address + amount_total + shipping_cost.amount_total.
export type StripeSessionSnapshot = {
  shipping?: StripeShippingDetails;
  amountTotal?: number;
  shippingCents?: number;
};

// Order columns a paid session backfills — column-named so consumers spread the
// result straight into a drizzle `.set()`.
export type OrderShippingBackfill = Partial<{
  shipName: string;
  shipLine1: string;
  shipLine2: string;
  shipCity: string;
  shipRegion: string;
  shipPostal: string;
  shipCountry: string;
  shipPhone: string;
  shippingCents: number;
  totalCents: number;
}>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

// Pull the shipping/total snapshot from a checkout-session-shaped object,
// keeping only string/number fields. Shipping comes from the newer
// `collected_information.shipping_details` or the legacy `shipping_details`.
export function extractSessionSnapshot(object: unknown): StripeSessionSnapshot {
  const obj = (object ?? {}) as Record<string, unknown>;
  const snapshot: StripeSessionSnapshot = {};

  const collected = obj.collected_information as { shipping_details?: unknown } | null | undefined;
  const rawShipping = (collected?.shipping_details ?? obj.shipping_details) as
    | { name?: unknown; phone?: unknown; address?: Record<string, unknown> | null }
    | null
    | undefined;
  if (rawShipping) {
    const addr = (rawShipping.address ?? {}) as Record<string, unknown>;
    const shipping: StripeShippingDetails = {};
    const put = (v: string | undefined, k: keyof StripeShippingDetails) => {
      if (v !== undefined) shipping[k] = v;
    };
    put(str(rawShipping.name), "name");
    put(str(addr.line1), "line1");
    put(str(addr.line2), "line2");
    put(str(addr.city), "city");
    put(str(addr.state), "state");
    put(str(addr.postal_code), "postal");
    put(str(addr.country), "country");
    put(str(rawShipping.phone), "phone");
    if (Object.keys(shipping).length > 0) snapshot.shipping = shipping;
  }

  const amountTotal = num(obj.amount_total);
  if (amountTotal !== undefined) snapshot.amountTotal = amountTotal;

  const shippingCost = obj.shipping_cost as { amount_total?: unknown } | null | undefined;
  const shippingCents = num(shippingCost?.amount_total);
  if (shippingCents !== undefined) snapshot.shippingCents = shippingCents;

  return snapshot;
}

// Build the order-column backfill from a snapshot. The core address group
// (name/line1/city/region/postal) is ATOMIC — the customer_order CHECK forbids a
// half-written address — so it is emitted only when all five are present, and
// then together; partial Stripe data writes no address at all. Money fields are
// independent and always emitted when carried.
export function orderShippingBackfill(snapshot: StripeSessionSnapshot): OrderShippingBackfill {
  const set: OrderShippingBackfill = {};
  const s = snapshot.shipping;
  if (
    s &&
    s.name !== undefined &&
    s.line1 !== undefined &&
    s.city !== undefined &&
    s.state !== undefined &&
    s.postal !== undefined
  ) {
    set.shipName = s.name;
    set.shipLine1 = s.line1;
    set.shipCity = s.city;
    set.shipRegion = s.state;
    set.shipPostal = s.postal;
    if (s.line2 !== undefined) set.shipLine2 = s.line2;
    if (s.country !== undefined) set.shipCountry = s.country;
    if (s.phone !== undefined) set.shipPhone = s.phone;
  }
  if (typeof snapshot.shippingCents === "number") set.shippingCents = snapshot.shippingCents;
  if (typeof snapshot.amountTotal === "number") set.totalCents = snapshot.amountTotal;
  return set;
}
