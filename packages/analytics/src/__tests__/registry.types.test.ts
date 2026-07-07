// packages/analytics/src/__tests__/registry.types.test.ts
// Node-env type-safety test for the typed analytics event registry. No DOM,
// no runtime PostHog calls — this proves (at typecheck time) that the
// registry structurally prevents the bug class it exists to close: stringly
// -typed event names, mismatched props, and client-only events leaking into
// the server seam.
import { describe, it, expect, expectTypeOf } from "vite-plus/test";
import { createMiddleware } from "@tanstack/react-start";
import type { useCapture } from "../client";
import type { CheckoutFailureReason } from "../events";

// `../server/analytics-event` no longer statically pulls `./delivery` (posthog-node
// is a lazy import inside the server-only leg), so this pure type test resolves
// with no vendor/platform mocks. Nothing below is ever invoked.
import { makeAnalyticsEvent } from "../server/analytics-event";

type Capture = ReturnType<typeof useCapture>;

// Nothing in this function ever runs — it exists purely so the TypeScript
// compiler evaluates the calls inside it (and so each `@ts-expect-error`
// suppresses a real error). `vitest run` still collects/typechecks this file
// via the package's tsconfig (src/**/*.ts include), but the body itself is
// never invoked.
function _typeOnly() {
  const capture = null as unknown as Capture;

  // 1. Positive cases: correctly-shaped events type-check.
  capture("signed_in", { method: "passkey" });
  capture("product_viewed", {
    product_id: "p_1",
    product_slug: "vintage-tee",
    product_name: "Vintage Tee",
    price_cents: 2500,
    in_stock: true,
  });

  // 2. A non-registered event name (the exact old-bug-class name this
  // registry replaces: `signed_in_with_passkey` was folded into
  // `signed_in` + `{ method: "passkey" }`).
  // @ts-expect-error — "signed_in_with_passkey" is not a key of ClientEventProps
  capture("signed_in_with_passkey", {});

  // 3. Wrong prop shape: bad literal union member.
  // @ts-expect-error — "carrier_pigeon" is not a valid `method`
  capture("signed_in", { method: "carrier_pigeon" });

  // 3b. Wrong prop shape: wrong primitive type.
  // @ts-expect-error — item_count must be number, not string
  capture("checkout_started", { item_count: "3", subtotal_cents: 100, total_cents: 100 });

  // 4. Excess property on an otherwise-valid call.
  // @ts-expect-error — "extra" is not a key of ClientEventProps["signed_up"]
  capture("signed_up", { method: "email", extra: 1 });

  // 5. Empty-object (Record<string, never>) events accept `{}`.
  capture("signed_out", {});

  // 6. checkout_failed requires a properly-typed `reason`.
  capture("checkout_failed", {
    reason: "payment_declined" satisfies CheckoutFailureReason,
    item_count: 2,
    total_cents: 500,
  });
  // @ts-expect-error — "nope" is not a CheckoutFailureReason
  capture("checkout_failed", { reason: "nope", item_count: 2, total_cents: 500 });

  // 7. The server seam: makeAnalyticsEvent is bound to ServerEventProps only —
  // client-only events (e.g. "signed_in") must be rejected even though they
  // share no name collision risk with "order_placed".
  const analyticsEvent = makeAnalyticsEvent({
    app: "store",
    requireAuth: createMiddleware({ type: "function" }),
    environment: "test",
  });

  analyticsEvent("order_placed", () => ({
    properties: {
      order_number: "ORD-1",
      item_count: 2,
      subtotal_cents: 1000,
      shipping_cents: 200,
      total_cents: 1200,
    },
  }));

  // @ts-expect-error — "signed_in" is a ClientEvent, not a registered ServerEvent
  analyticsEvent("signed_in", () => ({ properties: { method: "passkey" } }));
}
void _typeOnly;

// expectTypeOf assertions run at typecheck time (zero runtime cost) and are
// the canonical vitest way to assert on types without invoking anything.
expectTypeOf<Capture>().toBeCallableWith("signed_in", { method: "passkey" });
expectTypeOf<Capture>().toBeCallableWith("product_viewed", {
  product_id: "p_1",
  product_slug: "vintage-tee",
  product_name: "Vintage Tee",
  price_cents: 2500,
  in_stock: true,
});
expectTypeOf<Capture>().toBeCallableWith("signed_out", {});
expectTypeOf<Capture>().toBeCallableWith("checkout_failed", {
  reason: "out_of_stock",
  item_count: 1,
  total_cents: 100,
});

describe("typed analytics event registry", () => {
  it("registry is typed", () => {
    expect(true).toBe(true);
  });
});
