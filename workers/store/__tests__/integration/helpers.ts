// Shared D1 seed/query helpers for the store's `*.itest.ts` pool suite.
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { OrderStatus, ProductStatus } from "@/lib/config";

const { productBase, productDraft, productVariant, customerOrder, orderItem } = schema;

export const db = drizzle(env.DB, { schema });

// Seed a product in the release model: the thin identity row plus its editable
// draft (which carries title/price). The `product_flat` compat view joins the
// two, so the pre-release read paths still see the old flat shape. Delete via
// `productBase` (cascades draft/release/image/variant); `product` is a view.
export async function seedProduct(opts: {
  id: string;
  slug?: string;
  title?: string;
  priceCents?: number;
  status?: ProductStatus;
  createdAt?: Date;
}) {
  const now = opts.createdAt ?? new Date();
  await db.insert(productBase).values({
    id: opts.id,
    slug: opts.slug ?? `slug-${opts.id}`,
    status: opts.status ?? "active",
    createdBySub: "admin",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(productDraft).values({
    productId: opts.id,
    revision: 1,
    title: opts.title ?? `Tee ${opts.id}`,
    priceCents: opts.priceCents ?? 3000,
    updatedBySub: "admin",
    updatedAt: now,
  });
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
