/**
 * `POST /cart/lookup.json` — resolves the current display data for the products
 * in the browser cart. The cart holds only variant ids, so the /cart island
 * posts the unique product ids (from its display-hint cache) here and this Site
 * endpoint returns each product's fresh active-release detail via the read-only
 * StoreCatalog binding (RFC-0001 D4). Unknown/inactive products are omitted, so
 * the island can prune lines that are no longer purchasable.
 *
 * This is a Site-owned path (Bouncer routes `/api/store/*` to Store and `/api/*`
 * to Guestlist, so the resolver deliberately lives under `/cart`, not `/api`).
 */
import type { APIRoute } from "astro";
import { getProductById, type ProductDetailDTO } from "../../lib/store-catalog";

export const prerender = false;

const MAX_IDS = 50;

export const POST: APIRoute = async ({ request }) => {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const rawIds =
    body && typeof body === "object" && Array.isArray((body as { productIds?: unknown }).productIds)
      ? (body as { productIds: unknown[] }).productIds
      : [];

  const ids = [
    ...new Set(rawIds.filter((x): x is string => typeof x === "string" && x.length > 0)),
  ].slice(0, MAX_IDS);

  const results = await Promise.all(
    ids.map(async (id) => {
      try {
        return await getProductById(id);
      } catch {
        return { ok: false as const, error: "not_found" as const };
      }
    }),
  );

  const products: ProductDetailDTO[] = results.flatMap((r) => (r.ok ? [r.value] : []));

  return new Response(JSON.stringify({ products }), {
    headers: { "content-type": "application/json" },
  });
};
