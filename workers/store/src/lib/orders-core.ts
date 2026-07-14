// Request-path cores for order server fns, extracted from the createServerFn
// wrappers (orders.functions.ts) so the D1 write path is pool-testable without
// the TanStack server-fn runtime — same split as checkout.ts.
import { eq } from "drizzle-orm";

import { customerOrder } from "@/db/schema";
import type { Db } from "@/lib/db";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { isAdminRole } from "@somewhatintelligent/kit/roles";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

// The shippingSchema shape (see orders.functions.ts).
export interface OrderShippingInput {
  name: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postal: string;
  country?: string;
  phone?: string;
}

export type UpdateOrderShippingResult = { ok: true } | { ok: false; error: "not_editable" };

/**
 * Edit an order's shipping address. Owner-or-admin (mirroring getMyOrder's
 * authz — throws NotFoundError/ForbiddenError), editable only while the order is
 * still 'pending' or 'paid' (before it ships). Writes the full address group in
 * one UPDATE, so the ship_address_atomic CHECK is never tripped.
 */
export async function updateOrderShippingCore(
  db: Db,
  session: PlatformSession,
  orderNumber: string,
  shipping: OrderShippingInput,
): Promise<UpdateOrderShippingResult> {
  const [order] = await db
    .select()
    .from(customerOrder)
    .where(eq(customerOrder.orderNumber, orderNumber))
    .limit(1);
  if (!order) throw new NotFoundError();
  const isOwner = session.user.id === order.userId;
  const isAdmin = isAdminRole(session.user.role);
  if (!isOwner && !isAdmin) throw new ForbiddenError();
  if (order.status !== "pending" && order.status !== "paid") {
    return { ok: false, error: "not_editable" };
  }
  await db
    .update(customerOrder)
    .set({
      shipName: shipping.name,
      shipLine1: shipping.line1,
      shipLine2: shipping.line2 ?? null,
      shipCity: shipping.city,
      shipRegion: shipping.region,
      shipPostal: shipping.postal,
      shipCountry: shipping.country ?? "CA",
      shipPhone: shipping.phone ?? null,
      updatedAt: new Date(),
    })
    .where(eq(customerOrder.id, order.id));
  return { ok: true };
}
