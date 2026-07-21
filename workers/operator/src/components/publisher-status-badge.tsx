import type { ComponentProps } from "react";
import { Badge } from "@si/ui/components/badge";

// Publisher draft lifecycle (texts + software): outline (unpublished draft),
// success (live/published), secondary (retired).
type PublisherState = "draft" | "published" | "retired";

const MAP: Record<
  PublisherState,
  { label: string; variant: ComponentProps<typeof Badge>["variant"] }
> = {
  draft: { label: "Draft", variant: "outline" },
  published: { label: "Published", variant: "success" },
  retired: { label: "Retired", variant: "secondary" },
};

export function PublisherStatusBadge({ state }: { state: PublisherState }) {
  const entry = MAP[state] ?? { label: state, variant: "outline" as const };
  return <Badge variant={entry.variant}>{entry.label}</Badge>;
}
