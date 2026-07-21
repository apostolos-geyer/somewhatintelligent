import type { ComponentProps } from "react";
import { Badge } from "@si/ui/components/badge";
import type { ProductStatus } from "@si/contracts";

// Draft lifecycle stamps: outline (unpublished draft), success (live), warning
// (temporarily off), secondary (archived).
const MAP: Record<
  ProductStatus,
  { label: string; variant: ComponentProps<typeof Badge>["variant"] }
> = {
  draft: { label: "Draft", variant: "outline" },
  active: { label: "Active", variant: "success" },
  unavailable: { label: "Unavailable", variant: "warning" },
  archived: { label: "Archived", variant: "secondary" },
};

export function ProductStatusBadge({ status }: { status: ProductStatus }) {
  const entry = MAP[status] ?? { label: status, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
