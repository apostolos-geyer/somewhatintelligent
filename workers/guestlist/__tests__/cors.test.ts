import { SELF } from "cloudflare:test";
import { platformDeployConfig } from "@si/config";

// Regression coverage for the bare-apex CORS bug: `corsOrigins` in
// `src/index.ts` used a suffix-only `\.${domain}$` pattern that requires a
// literal "." immediately before the domain, which every real subdomain has
// but the bare apex origin (e.g. "https://somewhatintelligent.ca", the
// character before the domain there is "/" from "https://") does not. That
// silently rejected script-initiated fetch/XHR calls made from the apex
// itself in production (staging never hit it because staging's canonical
// host is a subdomain, `staging.somewhatintelligent.ca`).
async function corsOriginHeaderFor(origin: string): Promise<string | null> {
  const res = await SELF.fetch("http://localhost/health", {
    headers: { Origin: origin },
  });
  return res.headers.get("access-control-allow-origin");
}

describe("CORS origin allowlist", () => {
  test("allows the bare apex origin", async () => {
    const origin = `https://${platformDeployConfig.baseDomain}`;
    expect(await corsOriginHeaderFor(origin)).toBe(origin);
  });

  test("allows a subdomain of the apex", async () => {
    const origin = `https://staging.${platformDeployConfig.baseDomain}`;
    expect(await corsOriginHeaderFor(origin)).toBe(origin);
  });

  test("allows a nested subdomain of the apex", async () => {
    const origin = `https://a.b.${platformDeployConfig.baseDomain}`;
    expect(await corsOriginHeaderFor(origin)).toBe(origin);
  });

  test("allows the bare dev domain and its subdomains", async () => {
    const bare = `http://${platformDeployConfig.devDomain}`;
    const sub = `http://guestlist.${platformDeployConfig.devDomain}`;
    expect(await corsOriginHeaderFor(bare)).toBe(bare);
    expect(await corsOriginHeaderFor(sub)).toBe(sub);
  });

  test("rejects an unrelated origin", async () => {
    expect(await corsOriginHeaderFor("https://evil.com")).toBeNull();
  });

  test("rejects a lookalike origin that merely contains the domain as a substring", async () => {
    expect(await corsOriginHeaderFor(`https://not${platformDeployConfig.baseDomain}`)).toBeNull();
    expect(
      await corsOriginHeaderFor(`https://${platformDeployConfig.baseDomain}.evil.com`),
    ).toBeNull();
  });
});
