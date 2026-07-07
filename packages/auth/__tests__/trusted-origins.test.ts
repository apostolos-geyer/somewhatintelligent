import { describe, expect, test } from "vitest";
import { createPlatformAuth, type CreatePlatformAuthOptions } from "../src/server";

// A no-op DB adapter FACTORY — see stripe-gating.test.ts for the full
// rationale. `createPlatformAuth` never touches the database just to build
// the options object, which is all these tests assert.
// biome-ignore lint: test-only stand-in; see stripe-gating.test.ts.
const fakeAdapterFactory = (): any => ({
  id: "test-fake-adapter",
  create: async () => {
    throw new Error("fakeAdapterFactory: not implemented (unused by these tests)");
  },
  findOne: async () => null,
  findMany: async () => [],
  count: async () => 0,
  update: async () => null,
  updateMany: async () => 0,
  delete: async () => {},
  deleteMany: async () => 0,
});

function baseOpts(authDomain: string): CreatePlatformAuthOptions {
  return {
    baseURL: "https://guestlist.example.test",
    secret: "test-secret",
    authDomain,
    identityUrl: "https://identity.example.test",
    requireEmailVerification: false,
    cookiePrefix: "platform",
    passkeyRpName: "Example",
    twoFactorIssuer: "Example",
    database: fakeAdapterFactory as unknown as CreatePlatformAuthOptions["database"],
    sendEmail: {
      verification: async () => {},
      resetPassword: async () => {},
      changeEmail: async () => {},
      deleteAccount: async () => {},
      magicLink: async () => {},
      invitation: async () => {},
    },
  };
}

// Regression coverage for the bare-apex trustedOrigins bug: the wildcard
// pattern `*.${apex}` alone never matches the bare apex itself (Better
// Auth's `wildcardMatch` requires a literal "." immediately before `apex`,
// which every subdomain has but the bare apex — e.g.
// "https://somewhatintelligent.ca" — does not), so script-initiated
// requests from the platform's canonical production host were rejected as
// untrusted.
describe("createPlatformAuth trustedOrigins", () => {
  test("includes the bare apex alongside the subdomain wildcard, both schemes", () => {
    const auth = createPlatformAuth(baseOpts(".example.test"));
    expect(auth.options.trustedOrigins).toEqual([
      "https://example.test",
      "https://*.example.test",
      "http://example.test",
      "http://*.example.test",
    ]);
  });

  test("strips a leading dot from a cookie-domain-style authDomain", () => {
    const auth = createPlatformAuth(baseOpts(".somewhatintelligent.ca"));
    expect(auth.options.trustedOrigins).toContain("https://somewhatintelligent.ca");
  });
});
