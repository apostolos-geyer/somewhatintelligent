import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { useCapture, useCaptureException } from "@si/analytics/client";
import type { CheckoutFailureReason } from "@si/analytics/events";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { useCart } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { calculateShipping } from "@/lib/config";
import { placeOrder } from "@/lib/orders.functions";

export const Route = createFileRoute("/_app/checkout")({
  component: Checkout,
});

function toCheckoutFailureReason(error: string): CheckoutFailureReason {
  return error === "out_of_stock" ? "out_of_stock" : "unknown";
}

const checkoutSchema = type({
  name: "2 <= string <= 120",
  line1: "1 <= string <= 160",
  line2: "string <= 160",
  city: "1 <= string <= 80",
  region: "1 <= string <= 80",
  postal: "1 <= string <= 20",
  phone: "string <= 40",
});

function Checkout() {
  const { lines, subtotalCents, clear } = useCart();
  const navigate = useNavigate();
  const capture = useCapture();
  const captureException = useCaptureException();

  const shippingCents = calculateShipping(subtotalCents);
  const totalCents = subtotalCents + shippingCents;

  useEffect(() => {
    if (lines.length > 0) {
      capture("checkout_started", {
        item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
        subtotal_cents: subtotalCents,
        total_cents: totalCents,
      });
    }
  }, []);

  const form = useAppForm({
    defaultValues: { name: "", line1: "", line2: "", city: "", region: "", postal: "", phone: "" },
    validators: { onChange: checkoutSchema },
    onSubmit: async ({ value }) => {
      if (lines.length === 0) {
        toast.error("Your cart is empty");
        return;
      }
      try {
        const result = await placeOrder({
          data: {
            items: lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity })),
            shipping: {
              name: value.name,
              line1: value.line1,
              ...(value.line2 ? { line2: value.line2 } : {}),
              city: value.city,
              region: value.region,
              postal: value.postal,
              country: "CA",
              ...(value.phone ? { phone: value.phone } : {}),
            },
          },
        });
        if (!result.ok) {
          capture("checkout_failed", {
            reason: toCheckoutFailureReason(result.error),
            item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
            total_cents: totalCents,
          });
          toast.error(result.message ? `${result.error}: ${result.message}` : result.error);
          return;
        }
        clear();
        toast.success("Order placed!");
        void navigate({ to: "/orders/$orderNumber", params: { orderNumber: result.orderNumber } });
      } catch (err) {
        captureException(err);
        toast.error(err instanceof Error ? err.message : "Checkout failed");
      }
    },
  });

  if (lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 md:px-6">
        <Card variant="soft" className="p-12 text-center">
          <p className="text-text-tertiary font-mono text-sm">Nothing to check out.</p>
          <Button className="mt-4" nativeButton={false} render={<Link to="/" />}>
            Browse the shop
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-text mb-6 text-3xl font-light tracking-tight">Checkout</h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="grid gap-8 md:grid-cols-[1fr_320px]"
      >
        <Card className="p-6">
          <h2 className="text-text mb-4 font-semibold">Shipping address</h2>
          <div className="grid gap-4">
            <form.AppField name="name">
              {(field) => <field.TextField label="Full name" autoComplete="name" />}
            </form.AppField>
            <form.AppField name="line1">
              {(field) => <field.TextField label="Address" autoComplete="address-line1" />}
            </form.AppField>
            <form.AppField name="line2">
              {(field) => (
                <field.TextField label="Apartment, suite, etc." autoComplete="address-line2" />
              )}
            </form.AppField>
            <div className="grid grid-cols-2 gap-4">
              <form.AppField name="city">
                {(field) => <field.TextField label="City" autoComplete="address-level2" />}
              </form.AppField>
              <form.AppField name="region">
                {(field) => <field.TextField label="Province" autoComplete="address-level1" />}
              </form.AppField>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <form.AppField name="postal">
                {(field) => <field.TextField label="Postal code" autoComplete="postal-code" />}
              </form.AppField>
              <form.AppField name="phone">
                {(field) => <field.TextField label="Phone" type="tel" autoComplete="tel" />}
              </form.AppField>
            </div>
          </div>
        </Card>

        <div>
          <Card variant="soft" className="p-5">
            <h2 className="text-text mb-3 font-semibold">Order summary</h2>
            <div className="divide-border divide-y-2 divide-dashed">
              {lines.map((l) => (
                <div key={l.variantId} className="flex justify-between gap-2 py-2 text-sm">
                  <span className="text-text-secondary truncate">
                    {l.title}{" "}
                    <span className="text-text-tertiary">
                      · {l.size} ×{l.quantity}
                    </span>
                  </span>
                  <span className="text-text shrink-0 font-mono">
                    {formatCents(l.priceCents * l.quantity)}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-3 space-y-1.5 font-mono text-sm">
              <Row label="Subtotal" value={formatCents(subtotalCents)} />
              <Row
                label="Shipping"
                value={shippingCents === 0 ? "Free" : formatCents(shippingCents)}
              />
              <div className="border-border mt-2 flex justify-between border-t-2 border-dashed pt-2 text-base">
                <span className="text-text font-semibold">Total</span>
                <span className="text-text font-semibold">{formatCents(totalCents)}</span>
              </div>
            </div>
            <form.AppForm>
              <form.SubmitButton
                label="Place order"
                loadingLabel="Placing order…"
                size="lg"
                className="mt-5 w-full"
              />
            </form.AppForm>
            <p className="text-text-tertiary mt-2 text-center font-mono text-[11px]">
              Payment is collected on confirmation (no card charged here).
            </p>
          </Card>
        </div>
      </form>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-text-secondary flex justify-between">
      <span>{label}</span>
      <span className="text-text">{value}</span>
    </div>
  );
}
