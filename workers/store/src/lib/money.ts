// All prices are stored as integer cents (CAD). Format for display only.
export function formatCents(cents: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(cents / 100);
}

// Parse a user-entered dollar string (e.g. "29.99", "$30") to integer cents.
// Returns null on anything unparseable or negative.
export function dollarsToCents(input: string): number | null {
  const cleaned = input.replace(/[^0-9.]/g, "");
  if (cleaned === "") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}
