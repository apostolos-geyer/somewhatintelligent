/**
 * PURE product helpers — the tag/province vocabulary + parsers. No
 * `cloudflare:workers`, no env, no React, so they're unit-testable in plain node
 * (mirroring `brand.ts` / `feed-label.ts`). `drops.functions` re-exports these so
 * server + UI keep importing them from one place.
 */

/**
 * Cross-cutting product TAGS (distinct from the grouping `category`): the
 * rotational/flow-through/wholesale descriptors. `rotational` additionally drives
 * a scroll-callout on the lineup card.
 */
export const PRODUCT_TAGS = ["rotational", "flow-through", "wholesale"] as const;
export type ProductTag = (typeof PRODUCT_TAGS)[number];

export function isProductTag(v: unknown): v is ProductTag {
  return typeof v === "string" && (PRODUCT_TAGS as readonly string[]).includes(v);
}

/** Human label for a tag chip. */
export const PRODUCT_TAG_LABEL: Record<ProductTag, string> = {
  rotational: "Rotational",
  "flow-through": "Flow-through",
  wholesale: "Wholesale",
};

/** Canadian province/territory codes for the provincial-wholesale context. */
export const CANADIAN_PROVINCES = [
  "AB",
  "BC",
  "MB",
  "NB",
  "NL",
  "NS",
  "NT",
  "NU",
  "ON",
  "PE",
  "QC",
  "SK",
  "YT",
] as const;
export type Province = (typeof CANADIAN_PROVINCES)[number];

export function isProvince(v: unknown): v is Province {
  return typeof v === "string" && (CANADIAN_PROVINCES as readonly string[]).includes(v);
}

/** Safe JSON → ProductTag[]; drops unknown tags + dups; never throws. */
export function parseTags(json: string | null | undefined): ProductTag[] {
  if (!json) return [];
  try {
    const raw = JSON.parse(json) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: ProductTag[] = [];
    for (const v of raw) if (isProductTag(v) && !out.includes(v)) out.push(v);
    return out;
  } catch {
    return [];
  }
}
