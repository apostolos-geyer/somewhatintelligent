import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { loadStripe, type Stripe, type StripeCheckoutShippingOption } from "@stripe/stripe-js";
import {
  CheckoutProvider,
  PaymentElement,
  ShippingAddressElement,
  useCheckout,
} from "@stripe/react-stripe-js/checkout";
import { useCapture, useCaptureException } from "@si/analytics/client";
import type { CheckoutFailureReason } from "@si/analytics/events";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { useCart, type CartLine } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { calculateShipping } from "@/lib/config";
import { placeOrder } from "@/lib/orders.functions";
import { createCheckoutSession, getCheckoutConfig } from "@/lib/checkout.functions";

export const Route = createFileRoute("/_app/checkout/")({
  // stripeEnabled comes from the server (the full stripeConfigured gate) — when
  // false the manual placeOrder form renders unchanged (INV-7 / Track G1).
  loader: async () => getCheckoutConfig(),
  component: Checkout,
});

function Checkout() {
  const { stripeEnabled } = Route.useLoaderData();
  return stripeEnabled ? <StripeCheckout /> : <ManualCheckout />;
}

function toCheckoutFailureReason(error: string): CheckoutFailureReason {
  return error === "out_of_stock" ? "out_of_stock" : "unknown";
}

function itemsFrom(lines: CartLine[]) {
  return lines.map((l) => ({ variantId: l.variantId, quantity: l.quantity }));
}

function itemCount(lines: CartLine[]) {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
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

type CheckoutFormValues = typeof checkoutSchema.infer;

// Stripe.js loads only from js.stripe.com via the npm loader — never bundled
// (PCI SAQ-A). Lazily initialized in-browser (only when the payment step
// mounts), so SSR never touches it.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(import.meta.env.STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}

// Manual (non-Stripe) checkout: the buyer's address is collected here and sent
// straight to placeOrder. Renders whenever Stripe is unconfigured.
function ManualCheckout() {
  const { lines, subtotalCents, clear } = useCart();
  const navigate = useNavigate();
  const capture = useCapture();
  const captureException = useCaptureException();

  const shippingCents = calculateShipping(subtotalCents);
  const totalCents = subtotalCents + shippingCents;

  useEffect(() => {
    if (lines.length > 0) {
      capture("checkout_started", {
        item_count: itemCount(lines),
        subtotal_cents: subtotalCents,
        total_cents: totalCents,
      });
    }
  }, []);

  const form = useAppForm({
    defaultValues: { name: "", line1: "", line2: "", city: "", region: "", postal: "", phone: "" },
    validators: { onChange: checkoutSchema },
    onSubmit: async ({ value }: { value: CheckoutFormValues }) => {
      if (lines.length === 0) {
        toast.error("Your cart is empty");
        return;
      }
      try {
        const result = await placeOrder({
          data: {
            items: itemsFrom(lines),
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
            item_count: itemCount(lines),
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

  if (lines.length === 0) return <EmptyCart />;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-foreground mb-6 text-3xl font-light tracking-tight">
        Checkout
      </h1>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
        className="grid gap-8 md:grid-cols-[1fr_320px]"
      >
        <Card className="p-6">
          <h2 className="text-foreground mb-4 font-semibold">Shipping address</h2>
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
            <h2 className="text-foreground mb-3 font-semibold">Order summary</h2>
            <OrderLines lines={lines} />
            <OrderTotals
              subtotal={formatCents(subtotalCents)}
              shipping={shippingCents === 0 ? "Free" : formatCents(shippingCents)}
              total={formatCents(totalCents)}
            />
            <form.AppForm>
              <form.SubmitButton
                label="Place order"
                loadingLabel="Placing order…"
                size="lg"
                className="mt-5 w-full"
              />
            </form.AppForm>
            <p className="text-muted-foreground mt-2 text-center font-mono text-[11px]">
              Payment is collected on confirmation (no card charged here).
            </p>
          </Card>
        </div>
      </form>
    </div>
  );
}

// Stripe branch. Stripe now owns the shipping address (collected in the payment
// step) and the shipping rate; the pre-payment step only reviews the cart and
// reserves stock via createCheckoutSession, whose client_secret mounts the
// embedded checkout.
function StripeCheckout() {
  const { lines, subtotalCents } = useCart();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  if (clientSecret) {
    return (
      <CheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
        <PaymentPhase lines={lines} fallbackSubtotalCents={subtotalCents} />
      </CheckoutProvider>
    );
  }

  return <PrePaymentPhase lines={lines} subtotalCents={subtotalCents} onReady={setClientSecret} />;
}

// Pre-payment review: order summary + "Continue to payment". No address form —
// Stripe collects the shipping address and rate in the payment step, so the
// shipping row reads "Calculated at payment" here.
function PrePaymentPhase({
  lines,
  subtotalCents,
  onReady,
}: {
  lines: CartLine[];
  subtotalCents: number;
  onReady: (clientSecret: string) => void;
}) {
  const capture = useCapture();
  const captureException = useCaptureException();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (lines.length > 0) {
      capture("checkout_started", {
        item_count: itemCount(lines),
        subtotal_cents: subtotalCents,
        total_cents: subtotalCents,
      });
    }
  }, []);

  const start = async () => {
    if (submitting || lines.length === 0) return;
    setSubmitting(true);
    try {
      const result = await createCheckoutSession({ data: { items: itemsFrom(lines) } });
      if (!result.ok) {
        capture("checkout_failed", {
          reason: toCheckoutFailureReason(result.error),
          item_count: itemCount(lines),
          total_cents: subtotalCents,
        });
        toast.error(result.message ? `${result.error}: ${result.message}` : result.error);
        setSubmitting(false);
        return;
      }
      if (result.mode !== "elements") {
        // stripeEnabled and a stub result share the same gate, so this is
        // unreachable in practice — surface it rather than silently stalling.
        toast.error("Checkout is unavailable right now");
        setSubmitting(false);
        return;
      }
      onReady(result.clientSecret);
    } catch (err) {
      captureException(err);
      toast.error(err instanceof Error ? err.message : "Checkout failed");
      setSubmitting(false);
    }
  };

  if (lines.length === 0) return <EmptyCart />;

  return (
    <div className="mx-auto max-w-xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-foreground mb-6 text-3xl font-light tracking-tight">
        Checkout
      </h1>
      <Card variant="soft" className="p-6">
        <h2 className="text-foreground mb-3 font-semibold">Order summary</h2>
        <OrderLines lines={lines} />
        <OrderTotals subtotal={formatCents(subtotalCents)} shipping="Calculated at payment" />
        <Button
          size="lg"
          className="mt-5 w-full"
          disabled={submitting}
          onClick={() => void start()}
        >
          {submitting ? "Preparing checkout…" : "Continue to payment"}
        </Button>
        <p className="text-muted-foreground mt-2 text-center font-mono text-[11px]">
          Shipping address and card details are entered securely on the next step.
        </p>
      </Card>
    </div>
  );
}

// Payment step (inside <CheckoutProvider>): Stripe's ShippingAddressElement +
// shipping-method picker + PaymentElement. Totals are session-driven so rate
// switches update live; confirm() auto-attaches the collected address.
function PaymentPhase({
  lines,
  fallbackSubtotalCents,
}: {
  lines: CartLine[];
  fallbackSubtotalCents: number;
}) {
  const checkout = useCheckout();
  const capture = useCapture();
  const [submitting, setSubmitting] = useState(false);

  const session = checkout.type === "success" ? checkout.checkout : null;
  const subtotalCents = session?.total.subtotal.minorUnitsAmount ?? fallbackSubtotalCents;
  const shippingCents = session?.total.shippingRate.minorUnitsAmount ?? null;
  const totalCents = session?.total.total.minorUnitsAmount ?? fallbackSubtotalCents;
  const shippingOptions = session?.shippingOptions ?? [];
  const selectedShippingId = session?.shipping?.shippingOption.id ?? null;

  const pay = async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    const res = await session.confirm();
    if (res.type === "error") {
      // On success Stripe redirects to return_url; only errors return here.
      setSubmitting(false);
      capture("checkout_failed", {
        reason: "payment_declined",
        item_count: itemCount(lines),
        total_cents: totalCents,
      });
      toast.error(res.error.message);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-6 md:py-12">
      <h1 className="font-display text-foreground mb-6 text-3xl font-light tracking-tight">
        Payment
      </h1>
      <div className="grid gap-8 md:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-foreground mb-4 font-semibold">Shipping</h2>
            {checkout.type === "error" ? (
              <p className="text-destructive font-mono text-sm">{checkout.error.message}</p>
            ) : (
              <>
                <ShippingAddressElement />
                {shippingOptions.length > 1 && (
                  <ShippingOptionPicker
                    options={shippingOptions}
                    selectedId={selectedShippingId}
                    onSelect={(id) => void session?.updateShippingOption(id)}
                  />
                )}
              </>
            )}
          </Card>

          <Card className="p-6">
            <h2 className="text-foreground mb-4 font-semibold">Card details</h2>
            {checkout.type === "error" ? (
              <p className="text-destructive font-mono text-sm">{checkout.error.message}</p>
            ) : (
              <PaymentElement />
            )}
            {checkout.type === "loading" && (
              <p className="text-muted-foreground mt-3 font-mono text-sm">Loading payment form…</p>
            )}
          </Card>
        </div>

        <div>
          <Card variant="soft" className="p-5">
            <h2 className="text-foreground mb-3 font-semibold">Order summary</h2>
            <OrderLines lines={lines} />
            <OrderTotals
              subtotal={formatCents(subtotalCents)}
              shipping={
                shippingCents === null
                  ? "Calculated at payment"
                  : shippingCents === 0
                    ? "Free"
                    : formatCents(shippingCents)
              }
              total={session ? formatCents(totalCents) : undefined}
            />
            <Button
              size="lg"
              className="mt-5 w-full"
              disabled={!session || submitting}
              onClick={() => void pay()}
            >
              {submitting ? "Processing…" : session ? `Pay ${formatCents(totalCents)}` : "Pay"}
            </Button>
            <p className="text-muted-foreground mt-2 text-center font-mono text-[11px]">
              Payments are processed securely by Stripe.
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}

// Radio list of the session's Stripe-Dashboard shipping rates; selecting one
// drives updateShippingOption, which re-prices the session.
function ShippingOptionPicker({
  options,
  selectedId,
  onSelect,
}: {
  options: StripeCheckoutShippingOption[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <fieldset className="mt-4 space-y-2">
      <legend className="text-foreground mb-2 text-sm font-medium">Shipping method</legend>
      {options.map((opt) => {
        const checked = opt.id === selectedId;
        return (
          <label
            key={opt.id}
            className={`flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 text-sm transition-colors ${
              checked ? "border-primary bg-primary/5" : "border-border hover:border-foreground"
            }`}
          >
            <span className="flex items-center gap-2">
              <input
                type="radio"
                name="shipping-option"
                value={opt.id}
                checked={checked}
                onChange={() => onSelect(opt.id)}
                className="accent-primary"
              />
              <span className="text-foreground">{opt.displayName ?? "Shipping"}</span>
            </span>
            <span className="text-muted-foreground font-mono">
              {opt.minorUnitsAmount === 0 ? "Free" : formatCents(opt.minorUnitsAmount)}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

function EmptyCart() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 md:px-6">
      <Card variant="soft" className="p-12 text-center">
        <p className="text-muted-foreground font-mono text-sm">Nothing to check out.</p>
        <Button className="mt-4" nativeButton={false} render={<Link to="/" />}>
          Browse the shop
        </Button>
      </Card>
    </div>
  );
}

function OrderLines({ lines }: { lines: CartLine[] }) {
  return (
    <div className="divide-border divide-y">
      {lines.map((l) => (
        <div key={l.variantId} className="flex justify-between gap-2 py-2 text-sm">
          <span className="text-muted-foreground truncate">
            {l.title}{" "}
            <span className="text-muted-foreground">
              · {l.size} ×{l.quantity}
            </span>
          </span>
          <span className="text-foreground shrink-0 font-mono">
            {formatCents(l.priceCents * l.quantity)}
          </span>
        </div>
      ))}
    </div>
  );
}

// Pre-formatted rows so one component serves the manual, pre-payment, and
// session-driven summaries. `total` is omitted while it is not yet known.
function OrderTotals({
  subtotal,
  shipping,
  total,
}: {
  subtotal: string;
  shipping: string;
  total?: string;
}) {
  return (
    <div className="mt-3 space-y-1.5 font-mono text-sm">
      <Row label="Subtotal" value={subtotal} />
      <Row label="Shipping" value={shipping} />
      {total !== undefined && (
        <div className="border-border mt-2 flex justify-between border-t pt-2 text-base">
          <span className="text-foreground font-semibold">Total</span>
          <span className="text-foreground font-semibold">{total}</span>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-muted-foreground flex justify-between">
      <span>{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}
