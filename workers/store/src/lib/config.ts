// Code constants. Environment-dependent values live in wrangler.jsonc and are
// read through `env.*` / `import.meta.env.*` at runtime.
import { platformConfig } from "@si/config";
import { ulid } from "@somewhatintelligent/kit/ids";
import { STORE_TAGLINE } from "@/app-brand";

// Brand NAME is platform-wide (@si/config); the storefront tagline is per-app
// (src/app-brand.ts). Do not scatter brand literals — CLAUDE.md.
export const BRAND_NAME = platformConfig.brand.name;
export const BRAND_TAGLINE = STORE_TAGLINE;

// Single source of truth for order numbers, shared by placeOrder
// (orders.functions.ts) and the Stripe checkout path (lib/checkout.ts).
export function orderNumber(): string {
  return `${platformConfig.brand.short}-${ulid().slice(-6).toUpperCase()}`;
}

// Presigned product-image read URL lifetime. Short; the /api/img route
// re-mints per request and Roadie caches the signed URL in D1.
export const IMAGE_URL_LIFETIME_SECONDS = 3_600;

// Clothing sizes offered, in display order. Used to order variants in the UI.
export const SIZE_ORDER = ["XS", "S", "M", "L", "XL", "2XL", "3XL"] as const;

// Carriers we hand tracking numbers to. `url` is a template — `{tracking}` is
// replaced with the tracking number to build a customer-facing tracking link.
export const CARRIERS = {
  canadapost: {
    label: "Canada Post",
    url: "https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor={tracking}",
  },
  ups: { label: "UPS", url: "https://www.ups.com/track?tracknum={tracking}" },
  usps: { label: "USPS", url: "https://tools.usps.com/go/TrackConfirmAction?tLabels={tracking}" },
  fedex: { label: "FedEx", url: "https://www.fedex.com/fedextrack/?trknbr={tracking}" },
  dhl: { label: "DHL", url: "https://www.dhl.com/en/express/tracking.html?AWB={tracking}" },
} as const;

export type CarrierKey = keyof typeof CARRIERS;

// Single source of truth for the carrier keys (e.g. for validators).
export const CARRIER_KEYS = Object.keys(CARRIERS) as [CarrierKey, ...CarrierKey[]];

export function trackingUrlFor(carrier: string | null, tracking: string | null): string | null {
  if (!carrier || !tracking) return null;
  const entry = CARRIERS[carrier as CarrierKey];
  if (!entry) return null;
  return entry.url.replace("{tracking}", encodeURIComponent(tracking));
}

// Combined order + shipment lifecycle. Single source of truth for the schema
// enum, the status badge, and the admin order filters.
export const ORDER_STATUSES = ["pending", "paid", "shipped", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export function isOrderStatus(s: string): s is OrderStatus {
  const all: readonly string[] = ORDER_STATUSES;
  return all.includes(s);
}

// Product lifecycle: draft (hidden) → active (listed) → archived. Single source
// for the schema enum + the catalog form's status field/validator.
export const PRODUCT_STATUSES = ["draft", "active", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// Shipping: flat rate, free over the threshold. Used by both the checkout
// preview (client) and placeOrder (server) so the two never drift.
export const FLAT_SHIPPING_CENTS = 1_000; // $10
export const FREE_SHIPPING_THRESHOLD_CENTS = 7_500; // free over $75

export function calculateShipping(subtotalCents: number): number {
  if (subtotalCents <= 0) return 0;
  return subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS ? 0 : FLAT_SHIPPING_CENTS;
}
