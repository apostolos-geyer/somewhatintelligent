// Derive a coarse, privacy-preserving label for an anonymous Roadie actor.
// Mirrors apps/transfers/src/lib/http.ts.
export function deriveAnonymousLabel(request: Request): string {
  const country = request.headers.get("cf-ipcountry") ?? "Unknown";
  const ua = request.headers.get("user-agent") ?? "";
  let browser: "Chrome" | "Firefox" | "Safari" | "Edge" | "Other" = "Other";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Safari\//.test(ua)) browser = "Safari";
  return `anonymous shopper from ${country} on ${browser}`;
}
