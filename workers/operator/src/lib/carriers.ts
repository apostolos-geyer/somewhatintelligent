/**
 * Carriers the console can hand a tracking number to. `StoreOperator.fulfillOrder`
 * takes a free-form `carrier` string; this is the console's presentation list and
 * the fulfillment form's dropdown source. `url` is a template — `{tracking}` is
 * substituted to build a customer-facing tracking link.
 */
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

export const CARRIER_KEYS = Object.keys(CARRIERS) as [CarrierKey, ...CarrierKey[]];

export const CARRIER_OPTIONS = Object.entries(CARRIERS).map(([value, v]) => ({
  value,
  label: v.label,
}));

/** Human label for a stored carrier key, falling back to the raw value. */
export function carrierLabel(carrier: string | null): string | null {
  if (!carrier) return null;
  return CARRIERS[carrier as CarrierKey]?.label ?? carrier;
}

/** Customer-facing tracking URL, or null when the carrier is unknown. */
export function trackingUrlFor(carrier: string | null, tracking: string | null): string | null {
  if (!carrier || !tracking) return null;
  const entry = CARRIERS[carrier as CarrierKey];
  if (!entry) return null;
  return entry.url.replace("{tracking}", encodeURIComponent(tracking));
}
