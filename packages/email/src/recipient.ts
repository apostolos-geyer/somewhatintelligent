/**
 * Where a message actually goes per environment + transport.
 *
 * Production → the real recipient. Non-production → a safety sink so test/staging
 * traffic never reaches real inboxes. Resend has a built-in catch-all sink
 * (`delivered+…@resend.dev`, viewable in the Resend dashboard); Cloudflare Email
 * Service has no equivalent, so under it non-prod sends go straight to the
 * (test) address — guestlist only ever addresses test users in staging.
 */
export function emailTo(
  address: string,
  environment: string | undefined,
  provider: "resend" | "cloudflare" = "resend",
): string {
  if (environment === "production") return address;
  if (provider === "cloudflare") return address;
  return `delivered+${address.replace("@", ".")}@resend.dev`;
}
