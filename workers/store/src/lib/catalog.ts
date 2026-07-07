// Pure catalog helpers, extracted from products.functions.ts so the slug/SKU/
// size-ordering + cover/stock-rollup rules are unit-testable without the
// server-fn + D1 wrapper (behavior-identical extraction).
import { SIZE_ORDER } from "@/lib/config";

const SIZE_RANK = new Map(SIZE_ORDER.map((s, i) => [s as string, i]));

/** URL-safe slug: lowercase, non-alnum → "-", trimmed, ≤64 chars. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

/** Default SKU when the admin leaves it blank: `<slug>-<size>` upper-cased,
 *  stripped to A–Z/0–9/dash. */
export function skuFor(slug: string, size: string): string {
  return `${slug}-${size}`.toUpperCase().replace(/[^A-Z0-9-]/g, "");
}

/** Order variant rows by the canonical size order (unknown sizes sort last). */
export function sortBySize<T extends { size: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (SIZE_RANK.get(a.size) ?? 999) - (SIZE_RANK.get(b.size) ?? 999));
}

/** Per-product cover-image ref (first UPLOADED image by position) + summed stock. */
export function buildProductMaps(
  images: {
    productId: string;
    roadieReferenceId: string;
    position: number;
    uploadedAt: Date | null;
  }[],
  variants: { productId: string; stock: number }[],
): { cover: Map<string, string>; stock: Map<string, number> } {
  const cover = new Map<string, string>();
  for (const img of [...images].sort((a, b) => a.position - b.position)) {
    if (img.uploadedAt && !cover.has(img.productId)) {
      cover.set(img.productId, img.roadieReferenceId);
    }
  }
  const stock = new Map<string, number>();
  for (const v of variants) {
    stock.set(v.productId, (stock.get(v.productId) ?? 0) + v.stock);
  }
  return { cover, stock };
}
