/** Presentation helpers for the Operator console. Values are integer CAD cents. */
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
}

/** Format an epoch-millis timestamp as a short local date. */
export function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
