import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type } from "arktype";
import { toast } from "sonner";
import { loadStripe, type Stripe } from "@stripe/stripe-js";
import { CheckoutProvider, PaymentElement, useCheckout } from "@stripe/react-stripe-js/checkout";
import { useCapture, useCaptureException } from "@si/analytics/client";
import type { CheckoutFailureReason } from "@si/analytics/events";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { useAppForm } from "@si/ui/hooks/use-app-form";
import { useCart, type CartLine } from "@/lib/cart";
import { formatCents } from "@/lib/money";
import { calculateShipping } from "@/lib/config";
import { placeOrder, type PlaceOrderResult } from "@/lib/orders.functions";
import {
  createCheckoutSession,
  getCheckoutConfig,
  type CreateCheckoutSessionResult,
} from "@/lib/checkout.functions";

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

type OrderSubmitPayload = {
  items: { variantId: string; quantity: number }[];
  shipping: {
    name: string;
    line1: string;
    line2?: string;
    city: string;
    region: string;
    postal: string;
    country: "CA";
    phone?: string;
  };
};

function buildOrderSubmitPayload(lines: CartLine[], value: CheckoutFormValues): OrderSubmitPayload {
  return {
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
  };
}

type CheckoutSubmitFailure = { ok: false; error: string; message?: string };

// Stripe.js loads only from js.stripe.com via the npm loader — never bundled
// (PCI SAQ-A). Lazily initialized in-browser (only when the payment step
// mounts), so SSR never touches it.
let stripePromise: Promise<Stripe | null> | null = null;
function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) stripePromise = loadStripe(import.meta.env.STRIPE_PUBLISHABLE_KEY);
  return stripePromise;
}

// Shared shell for both checkout branches: shipping form, order summary, the
// checkout_started analytics effect, and submit/failure handling. Only the
// submit call, its success handling, and the button copy differ per branch.
function CheckoutForm<TSuccess extends { ok: true }>({
  lines,
  subtotalCents,
  submitLabel,
  submitLoadingLabel,
  footnote,
  submit,
  onSuccess,
}: {
  lines: CartLine[];
  subtotalCents: number;
  submitLabel: string;
  submitLoadingLabel: string;
  footnote: string;
  submit: (payload: OrderSubmitPayload) => Promise<TSuccess | CheckoutSubmitFailure>;
  onSuccess: (result: TSuccess) => void | Promise<void>;
}) {
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
        const result = await submit(buildOrderSubmitPayload(lines, value));
        if (!result.ok) {
          capture("checkout_failed", {
            reason: toCheckoutFailureReason(result.error),
            item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
            total_cents: totalCents,
          });
          toast.error(result.message ? `${result.error}: ${result.message}` : result.error);
          return;
        }
        await onSuccess(result);
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
              subtotalCents={subtotalCents}
              shippingCents={shippingCents}
              totalCents={totalCents}
            />
            <form.AppForm>
              <form.SubmitButton
                label={submitLabel}
                loadingLabel={submitLoadingLabel}
                size="lg"
                className="mt-5 w-full"
              />
            </form.AppForm>
            <p className="text-muted-foreground mt-2 text-center font-mono text-[11px]">
              {footnote}
            </p>
          </Card>
        </div>
      </form>
    </div>
  );
}

// Today's manual checkout, unchanged: submits the shipping form straight to
// placeOrder. Renders whenever Stripe is unconfigured.
function ManualCheckout() {
  const { lines, subtotalCents, clear } = useCart();
  const navigate = useNavigate();

  return (
    <CheckoutForm<Extract<PlaceOrderResult, { ok: true }>>
      lines={lines}
      subtotalCents={subtotalCents}
      submitLabel="Place order"
      submitLoadingLabel="Placing order…"
      footnote="Payment is collected on confirmation (no card charged here)."
      submit={(payload) => placeOrder({ data: payload })}
      onSuccess={(result) => {
        clear();
        toast.success("Order placed!");
        void navigate({ to: "/orders/$orderNumber", params: { orderNumber: result.orderNumber } });
      }}
    />
  );
}

// Stripe branch: shipping form stays ours (Track A3 — no Stripe address
// elements). On submit createCheckoutSession reserves stock + creates the
// Session; the returned client_secret mounts the embedded Payment Element.
function StripeCheckout() {
  const { lines, subtotalCents } = useCart();
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  if (clientSecret) {
    const shippingCents = calculateShipping(subtotalCents);
    const totalCents = subtotalCents + shippingCents;
    return (
      <CheckoutProvider stripe={getStripe()} options={{ clientSecret }}>
        <PaymentPhase
          lines={lines}
          subtotalCents={subtotalCents}
          shippingCents={shippingCents}
          totalCents={totalCents}
        />
      </CheckoutProvider>
    );
  }

  return (
    <CheckoutForm<Extract<CreateCheckoutSessionResult, { ok: true }>>
      lines={lines}
      subtotalCents={subtotalCents}
      submitLabel="Continue to payment"
      submitLoadingLabel="Preparing checkout…"
      footnote="Card details are entered securely on the next step."
      submit={(payload) => createCheckoutSession({ data: payload })}
      onSuccess={(result) => {
        if (result.mode !== "elements") {
          // stripeEnabled and a stub result share the same gate, so this is
          // unreachable in practice — surface it rather than silently stalling.
          toast.error("Checkout is unavailable right now");
          return;
        }
        setClientSecret(result.clientSecret);
      }}
    />
  );
}

// Rendered inside <CheckoutProvider>: the embedded Payment Element + the pay
// button, which calls checkout.confirm() (Stripe redirects to the server-set
// return_url on success). Disable-on-submit guards double-submits.
function PaymentPhase({
  lines,
  subtotalCents,
  shippingCents,
  totalCents,
}: {
  lines: CartLine[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}) {
  const checkout = useCheckout();
  const capture = useCapture();
  const [submitting, setSubmitting] = useState(false);

  const pay = async () => {
    if (checkout.type !== "success" || submitting) return;
    setSubmitting(true);
    const res = await checkout.checkout.confirm();
    if (res.type === "error") {
      // On success Stripe redirects to return_url; only errors return here.
      setSubmitting(false);
      capture("checkout_failed", {
        reason: "payment_declined",
        item_count: lines.reduce((sum, l) => sum + l.quantity, 0),
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

        <div>
          <Card variant="soft" className="p-5">
            <h2 className="text-foreground mb-3 font-semibold">Order summary</h2>
            <OrderLines lines={lines} />
            <OrderTotals
              subtotalCents={subtotalCents}
              shippingCents={shippingCents}
              totalCents={totalCents}
            />
            <Button
              size="lg"
              className="mt-5 w-full"
              disabled={checkout.type !== "success" || submitting}
              onClick={() => void pay()}
            >
              {submitting ? "Processing…" : `Pay ${formatCents(totalCents)}`}
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

function OrderTotals({
  subtotalCents,
  shippingCents,
  totalCents,
}: {
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
}) {
  return (
    <div className="mt-3 space-y-1.5 font-mono text-sm">
      <Row label="Subtotal" value={formatCents(subtotalCents)} />
      <Row label="Shipping" value={shippingCents === 0 ? "Free" : formatCents(shippingCents)} />
      <div className="border-border mt-2 flex justify-between border-t pt-2 text-base">
        <span className="text-foreground font-semibold">Total</span>
        <span className="text-foreground font-semibold">{formatCents(totalCents)}</span>
      </div>
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
