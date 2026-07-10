import { Badge } from "@si/ui/components/badge";
import type { OrderStatus } from "@/lib/config";

type Status = OrderStatus;

const MAP: Record<
  Status,
  { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }
> = {
  // DRAFT design-system status stamps: warning (pending), secondary
  // (in progress — no semantic "info" token in the new contract), inverse
  // fill (in transit), success (confirmed/done), destructive (rust).
  pending: { label: "Awaiting payment", variant: "warning" },
  paid: { label: "Paid · to ship", variant: "secondary" },
  shipped: { label: "Shipped", variant: "inverse" },
  delivered: { label: "Delivered", variant: "success" },
  cancelled: { label: "Cancelled", variant: "destructive" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const entry = MAP[status as Status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
