// Shared D1 seed/query helpers for the store's `*.itest.ts` pool suite.
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { OrderStatus, ProductStatus } from "@/lib/config";

const { productBase, productDraft, productRelease, productVariant, customerOrder, orderItem } =
  schema;

export const db = drizzle(env.DB, { schema });

// Seed a product in the release model: the thin identity row, its editable draft,
// and (unless `withRelease: false`) an active immutable release the identity row
// points at. Checkout and the public reads source title + price from the active
// release, so `title`/`priceCents` set the RELEASE values; `draftTitle`/
// `draftPriceCents` override the draft independently (default: mirror the
// release) to model a post-publish draft edit that must not reach checkout.
// `withRelease: false` seeds a draft-only product (no active release) for suites
// that manage releases themselves. Delete via `productBase` (cascades
// draft/release/image/variant); `product` is a view.
export async function seedProduct(opts: {
  id: string;
  slug?: string;
  title?: string;
  priceCents?: number;
  status?: ProductStatus;
  createdAt?: Date;
  draftTitle?: string;
  draftPriceCents?: number;
  releaseVersion?: string;
  withRelease?: boolean;
}) {
  const now = opts.createdAt ?? new Date();
  const slug = opts.slug ?? `slug-${opts.id}`;
  const title = opts.title ?? `Tee ${opts.id}`;
  const priceCents = opts.priceCents ?? 3000;
  await db.insert(productBase).values({
    id: opts.id,
    slug,
    status: opts.status ?? "active",
    createdBySub: "admin",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(productDraft).values({
    productId: opts.id,
    revision: 1,
    title: opts.draftTitle ?? title,
    priceCents: opts.draftPriceCents ?? priceCents,
    updatedBySub: "admin",
    updatedAt: now,
  });
  if (opts.withRelease === false) return;
  const releaseId = `rel-${opts.id}`;
  await db.insert(productRelease).values({
    id: releaseId,
    productId: opts.id,
    version: opts.releaseVersion ?? "1.0.0",
    slug,
    title,
    priceCents,
    publishedBySub: "admin",
    publishedAt: now,
  });
  await db
    .update(productBase)
    .set({ activeReleaseId: releaseId })
    .where(eq(productBase.id, opts.id));
}

export async function seedVariant(opts: {
  id: string;
  productId: string;
  size: string;
  stock: number;
  sku?: string;
  createdAt?: Date;
}) {
  await db.insert(productVariant).values({
    id: opts.id,
    productId: opts.productId,
    size: opts.size,
    sku: opts.sku ?? `SKU-${opts.id}`,
    stock: opts.stock,
    createdAt: opts.createdAt ?? new Date(),
  });
}

export async function seedOrder(opts: {
  id: string;
  orderNumber?: string;
  userId?: string;
  email?: string;
  status?: OrderStatus;
  paymentStatus?: string;
  stripeCustomerId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripeSessionExpiresAt?: Date | null;
  shipName?: string;
  shipLine1?: string;
  shipCity?: string;
  shipRegion?: string;
  shipPostal?: string;
  subtotalCents?: number;
  totalCents?: number;
  createdAt?: Date;
  updatedAt?: Date;
}) {
  const now = opts.createdAt ?? new Date();
  const userId = opts.userId ?? "buyer-1";
  await db.insert(customerOrder).values({
    id: opts.id,
    orderNumber: opts.orderNumber ?? `SI-${opts.id}`,
    userId,
    email: opts.email ?? `${userId}@example.com`,
    status: opts.status ?? "pending",
    paymentStatus: opts.paymentStatus ?? "unpaid",
    stripeCustomerId: opts.stripeCustomerId ?? null,
    stripeCheckoutSessionId: opts.stripeCheckoutSessionId ?? null,
    stripeSessionExpiresAt: opts.stripeSessionExpiresAt ?? null,
    shipName: opts.shipName ?? "Ada",
    shipLine1: opts.shipLine1 ?? "1 Main",
    shipCity: opts.shipCity ?? "Toronto",
    shipRegion: opts.shipRegion ?? "ON",
    shipPostal: opts.shipPostal ?? "M5V",
    subtotalCents: opts.subtotalCents ?? 3000,
    totalCents: opts.totalCents ?? opts.subtotalCents ?? 3000,
    createdAt: now,
    updatedAt: opts.updatedAt ?? now,
  });
}

export async function seedOrderItem(opts: {
  id: string;
  orderId: string;
  productId: string;
  variantId: string;
  titleSnapshot?: string;
  sizeSnapshot?: string;
  unitPriceCents?: number;
  quantity: number;
}) {
  await db.insert(orderItem).values({
    id: opts.id,
    orderId: opts.orderId,
    productId: opts.productId,
    variantId: opts.variantId,
    titleSnapshot: opts.titleSnapshot ?? "t",
    sizeSnapshot: opts.sizeSnapshot ?? "M",
    unitPriceCents: opts.unitPriceCents ?? 3000,
    quantity: opts.quantity,
  });
}

export async function stockOf(variantId: string) {
  const [row] = await db
    .select({ stock: productVariant.stock })
    .from(productVariant)
    .where(eq(productVariant.id, variantId));
  return row?.stock;
}
