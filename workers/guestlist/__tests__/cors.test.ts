import { SELF } from "cloudflare:test";

// Regression coverage for the bare-apex CORS bug: a suffix-only
// `\.${domain}$` pattern requires a literal "." immediately before the
// domain, which every real subdomain has but the bare apex origin does not
// (the character before it is "/" from "https://"), silently rejecting
// script-initiated fetch/XHR calls made from the apex itself.
// Domains here mirror si's config `corsDomains`
// ([platformDeployConfig.baseDomain, platformDeployConfig.devDomain]).
const BASE = "somewhatintelligent.ca";
const DEV = "somewhatintelligent.localhost";

async function corsOriginHeaderFor(origin: string): Promise<string | null> {
  const res = await SELF.fetch("http://localhost/health", {
    headers: { Origin: origin },
  });
  return res.headers.get("access-control-allow-origin");
}

describe("CORS origin allowlist", () => {
  test("allows the bare apex origin", async () => {
    expect(await corsOriginHeaderFor(`https://${BASE}`)).toBe(`https://${BASE}`);
  });

  test("allows a subdomain of the apex", async () => {
    expect(await corsOriginHeaderFor(`https://staging.${BASE}`)).toBe(`https://staging.${BASE}`);
  });

  test("allows a nested subdomain of the apex", async () => {
    expect(await corsOriginHeaderFor(`https://a.b.${BASE}`)).toBe(`https://a.b.${BASE}`);
  });

  test("allows the bare dev domain and its subdomains", async () => {
    expect(await corsOriginHeaderFor(`http://${DEV}`)).toBe(`http://${DEV}`);
    expect(await corsOriginHeaderFor(`http://guestlist.${DEV}`)).toBe(`http://guestlist.${DEV}`);
  });

  test("rejects an unrelated origin", async () => {
    expect(await corsOriginHeaderFor("https://evil.com")).toBeNull();
  });

  test("rejects a lookalike origin that merely contains the domain as a substring", async () => {
    expect(await corsOriginHeaderFor(`https://not${BASE}`)).toBeNull();
    expect(await corsOriginHeaderFor(`https://${BASE}.evil.com`)).toBeNull();
  });
});
