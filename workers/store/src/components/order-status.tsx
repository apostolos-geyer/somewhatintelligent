import { Badge } from "@si/ui/components/badge";
import type { OrderStatus } from "@/lib/config";

type Status = OrderStatus;

const MAP: Record<
  Status,
  { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }
> = {
  // DRAFT design-system status stamps carry state by border treatment:
  // warn = dashed (pending), info = dotted (in progress), contrast = graphite
  // fill (in transit), soft = solid green (confirmed/done), danger = rust.
  pending: { label: "Awaiting payment", variant: "warn" },
  paid: { label: "Paid · to ship", variant: "info" },
  shipped: { label: "Shipped", variant: "contrast" },
  delivered: { label: "Delivered", variant: "soft" },
  cancelled: { label: "Cancelled", variant: "danger" },
};

export function OrderStatusBadge({ status }: { status: string }) {
  const entry = MAP[status as Status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
