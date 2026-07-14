import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, ClockIcon, XCircleIcon } from "lucide-react";
import { Button } from "@si/ui/components/button";
import { Card } from "@si/ui/components/card";
import { useCart } from "@/lib/cart";
import { getOrderByStripeSession, type OrderByStripeSessionResult } from "@/lib/checkout.functions";

// Post-payment landing (Stripe redirects here from checkout.confirm()). UX only,
// never authoritative — fulfillment is driven by the webhook consumer, so this
// page polls getOrderByStripeSession until the order reaches a terminal state.
export const Route = createFileRoute("/_app/checkout/return")({
  validateSearch: (search: Record<string, unknown>): { session_id?: string } => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
  }),
  component: CheckoutReturn,
});

type Phase = "loading" | "processing" | "paid" | "cancelled" | "not_found" | "timeout";

// unpaid/processing (or pending) keeps polling; a paid/cancelled/failed/expired
// order is terminal.
function phaseFor(result: OrderByStripeSessionResult): Phase {
  if (!result.ok) return "not_found";
  if (result.paymentStatus === "paid" || result.status === "paid") return "paid";
  if (
    result.status === "cancelled" ||
    result.paymentStatus === "failed" ||
    result.paymentStatus === "expired"
  ) {
    return "cancelled";
  }
  return "processing";
}

const POLL_INTERVAL_MS = 2000;
const MAX_POLLS = 20;

function CheckoutReturn() {
  const { session_id } = Route.useSearch();
  const { clear } = useCart();
  const [phase, setPhase] = useState<Phase>("loading");
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const clearedRef = useRef(false);

  useEffect(() => {
    if (!session_id) {
      setPhase("not_found");
      return;
    }
    let cancelled = false;
    let polls = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      polls += 1;
      let result: OrderByStripeSessionResult | null;
      try {
        result = await getOrderByStripeSession({ data: { sessionId: session_id } });
      } catch {
        // Transient fetch failure — keep polling; a server not_found is real.
        result = null;
      }
      if (cancelled) return;

      const next = result ? phaseFor(result) : "processing";
      if (result?.ok) setOrderNumber(result.orderNumber);

      // The order existing here means payment was submitted (the session id is
      // attached before the buyer ever gets the client secret) — clear the cart
      // once, so a still-settling async payment can't be re-purchased (Track G2).
      if (result?.ok && next !== "cancelled" && !clearedRef.current) {
        clearedRef.current = true;
        clear();
      }

      const terminal = next === "paid" || next === "cancelled" || next === "not_found";
      if (terminal) {
        setPhase(next);
        return;
      }
      if (polls >= MAX_POLLS) {
        setPhase("timeout");
        return;
      }
      setPhase("processing");
      timer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [session_id]);

  return (
    <div className="mx-auto max-w-lg px-4 py-16 md:px-6">
      <Card variant="soft" className="p-10 text-center">
        {phase === "paid" ? (
          <View
            icon={<CheckCircle2Icon className="text-verdigris mx-auto size-10" />}
            title="Payment received"
            body="Thanks — your order is confirmed. A receipt is on its way to your email."
          >
            {orderNumber && (
              <Button
                className="mt-6"
                nativeButton={false}
                render={<Link to="/orders/$orderNumber" params={{ orderNumber }} />}
              >
                View order
              </Button>
            )}
          </View>
        ) : phase === "cancelled" ? (
          <View
            icon={<XCircleIcon className="text-destructive mx-auto size-10" />}
            title="Payment not completed"
            body="This checkout didn't go through and nothing was charged. Your cart is still saved — you can try again."
          >
            <Button className="mt-6" nativeButton={false} render={<Link to="/cart" />}>
              Back to cart
            </Button>
          </View>
        ) : phase === "timeout" ? (
          <View
            icon={<ClockIcon className="text-primary mx-auto size-10" />}
            title="Payment still processing"
            body="Your payment was submitted and is taking longer than usual to confirm. You'll get an email receipt when it completes — no need to order again."
          >
            <Button
              className="mt-6"
              nativeButton={false}
              render={
                orderNumber ? (
                  <Link to="/orders/$orderNumber" params={{ orderNumber }} />
                ) : (
                  <Link to="/orders" />
                )
              }
            >
              {orderNumber ? "View order" : "View my orders"}
            </Button>
          </View>
        ) : phase === "not_found" ? (
          <View
            icon={<XCircleIcon className="text-muted-foreground mx-auto size-10" />}
            title="Order not found"
            body="We couldn't find a checkout for this link."
          >
            <Button className="mt-6" nativeButton={false} render={<Link to="/" />}>
              Browse the shop
            </Button>
          </View>
        ) : (
          <View
            icon={<ClockIcon className="text-primary mx-auto size-10 animate-pulse" />}
            title="Confirming your payment"
            body="Hang tight — we're finalizing your order. This usually takes a few seconds."
          />
        )}
      </Card>
    </div>
  );
}

function View({
  icon,
  title,
  body,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      {icon}
      <h1 className="font-display text-foreground mt-4 text-2xl font-light tracking-tight">
        {title}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{body}</p>
      {children}
    </>
  );
}
