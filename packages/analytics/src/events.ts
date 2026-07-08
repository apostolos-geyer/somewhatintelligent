// packages/analytics/src/events.ts   →  @si/analytics/events  (isomorphic, zero deps)
export const APP_NAMES = ["identity", "store"] as const;
export type AppName = (typeof APP_NAMES)[number];
export type CheckoutFailureReason = "payment_declined" | "out_of_stock" | "network" | "unknown";

export interface ClientEventProps {
  signed_up: { method: "email" | "passkey" | "social" };
  signed_in: { method: "email" | "passkey" | "magic_link" | "social" };
  magic_link_requested: Record<string, never>;
  signed_out: Record<string, never>;
  password_changed: Record<string, never>;
  account_deleted: Record<string, never>;
  product_viewed: {
    product_id: string;
    product_slug: string;
    product_name: string;
    price_cents: number;
    in_stock: boolean;
  };
  cart_item_added: {
    product_id: string;
    variant_id: string;
    product_name: string;
    size: string;
    price_cents: number;
  };
  cart_item_removed: {
    variant_id: string;
    product_name: string;
    size: string;
    price_cents: number;
    quantity: number;
  };
  checkout_started: { item_count: number; subtotal_cents: number; total_cents: number };
  checkout_failed: { reason: CheckoutFailureReason; item_count: number; total_cents: number };
}
export type ClientEvent = keyof ClientEventProps;

export interface ServerEventProps {
  order_placed: {
    order_number: string;
    item_count: number;
    subtotal_cents: number;
    shipping_cents: number;
    total_cents: number;
  };
}
export type ServerEvent = keyof ServerEventProps;
