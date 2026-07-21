import type { ComponentProps } from "react";
import { Badge } from "@si/ui/components/badge";
import type { OrderStatus } from "@si/contracts";

// Status stamps across the order + shipment lifecycle: warning (awaiting
// payment), secondary (paid, to ship), inverse fill (in transit), success
// (delivered), destructive (cancelled).
const MAP: Record<
  OrderStatus,
  { label: string; variant: ComponentProps<typeof Badge>["variant"] }
> = {
  pending: { label: "Awaiting payment", variant: "warning" },
  paid: { label: "Paid · to ship", variant: "secondary" },
  shipped: { label: "Shipped", variant: "inverse" },
  delivered: { label: "Delivered", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const entry = MAP[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
