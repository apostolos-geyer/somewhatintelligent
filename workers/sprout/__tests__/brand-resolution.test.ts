import { describe, expect, test } from "vitest";
import {
  BRAND_COOKIE,
  BRAND_RESOLUTION_MODE,
  brandSlugResolvers,
  portalEntryUrl,
  resolveBrandSlug,
} from "@/lib/brand-resolution";

// `import.meta.env.BRAND_RESOLUTION` is unset under vitest, so the module-level
// mode defaults to "subdomain" — assert that, then exercise BOTH strategy
// callbacks directly (they don't depend on the active mode).
describe("brand-resolution strategy", () => {
  test("defaults to subdomain mode when unset", () => {
    expect(BRAND_RESOLUTION_MODE).toBe("subdomain");
    expect(BRAND_COOKIE).toBe("sprout_brand");
  });

  describe("subdomain strategy", () => {
    test("reads the host's leftmost label, ignoring any cookie", () => {
      expect(
        brandSlugResolvers.subdomain({ host: "acme.sproutportal.ca", brandCookie: "beta" }),
      ).toBe("acme");
      expect(
        brandSlugResolvers.subdomain({ host: "sproutportal.ca", brandCookie: "beta" }),
      ).toBeNull();
      expect(brandSlugResolvers.subdomain({ host: null, brandCookie: "beta" })).toBeNull();
    });
  });

  describe("path strategy", () => {
    test("reads the brand cookie, ignoring the host", () => {
      expect(
        brandSlugResolvers.path({ host: "sprout-staging.sproutportal.ca", brandCookie: "acme" }),
      ).toBe("acme");
      expect(
        brandSlugResolvers.path({ host: "sprout-staging.sproutportal.ca", brandCookie: null }),
      ).toBeNull();
      expect(brandSlugResolvers.path({ host: "x", brandCookie: "" })).toBeNull();
    });
  });

  test("resolveBrandSlug dispatches via the active (subdomain) mode", () => {
    expect(resolveBrandSlug({ host: "acme.sproutportal.ca", brandCookie: null })).toBe("acme");
    // cookie alone yields nothing in subdomain mode
    expect(resolveBrandSlug({ host: "sproutportal.ca", brandCookie: "acme" })).toBeNull();
  });

  describe("portalEntryUrl (subdomain mode)", () => {
    test("prepends the slug as a host label and applies the deep-link path", () => {
      expect(portalEntryUrl("https://sproutportal.ca", "acme")).toBe(
        "https://acme.sproutportal.ca/",
      );
      expect(portalEntryUrl("https://sproutportal.ca", "acme", "/requests")).toBe(
        "https://acme.sproutportal.ca/requests",
      );
    });
  });
});
