/** PURE string helpers — no `cloudflare:workers`, node-testable. */

/** Drop empty/whitespace-only strings → null so a cleared optional field clears the column. */
export function nullableTrim(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : null;
}
