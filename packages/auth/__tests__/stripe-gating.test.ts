import { describe, expect, test } from "vitest";
import { createPlatformAuth, type CreatePlatformAuthOptions } from "../src/server";

// A no-op DB adapter FACTORY (the shape `drizzleAdapter(db, opts)` itself
// returns: `(options) => DBAdapter`). Passing a plain object instead makes
// better-auth try to treat it as a raw Kysely-compatible connection and
// throw ("Direct database connection requires Kysely") from an un-awaited
// background init — this satisfies the adapter contract shape instead, so
// construction never touches a "database" at all (nothing here is called by
// merely building the plugin set, which is all these tests assert).
// biome-ignore lint: test-only stand-in; the real shape is `@better-auth/core`'s
// internal DBAdapter, not worth importing here just to type a never-called stub.
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

// Minimal opts shared by every case — only `stripe` varies. `database` is a
// stand-in (never touched: constructing the auth object doesn't hit the DB,
// same assumption `auth.codegen.ts` makes when it calls this factory with
// `process.env` + `{}` stubs to introspect the plugin set offline).
function baseOpts(stripe?: CreatePlatformAuthOptions["stripe"]): CreatePlatformAuthOptions {
  return {
    baseURL: "https://guestlist.example.test",
    secret: "test-secret",
    authDomain: ".example.test",
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
    stripe,
  };
}

function pluginIds(auth: ReturnType<typeof createPlatformAuth>): string[] {
  return (auth.options.plugins ?? []).map((p) => p.id);
}

describe("Stripe plugin gating", () => {
  test("no Stripe config at all: plugin absent, plugins array unaffected", () => {
    const withStripe = createPlatformAuth(baseOpts(undefined));
    const withoutStripeField = createPlatformAuth({
      ...baseOpts(undefined),
      stripe: undefined,
    });

    expect(pluginIds(withStripe)).not.toContain("stripe");
    // Byte-identical plugin set regardless of whether `stripe` key is
    // present-but-undefined or omitted entirely.
    expect(pluginIds(withStripe)).toEqual(pluginIds(withoutStripeField));
  });

  test("only secretKey present (no webhook secret): plugin still absent", () => {
    const auth = createPlatformAuth(
      baseOpts({ secretKey: "sk_test_fake", webhookSecret: "", memberPriceId: "price_fake" }),
    );
    expect(pluginIds(auth)).not.toContain("stripe");
  });

  test("only webhookSecret present (no secret key): plugin still absent", () => {
    const auth = createPlatformAuth(
      baseOpts({ secretKey: "", webhookSecret: "whsec_fake", memberPriceId: "price_fake" }),
    );
    expect(pluginIds(auth)).not.toContain("stripe");
  });

  test("both secretKey and webhookSecret present: plugin is added with the member plan", () => {
    const noStripe = createPlatformAuth(baseOpts(undefined));
    const withStripe = createPlatformAuth(
      baseOpts({
        secretKey: "sk_test_fake",
        webhookSecret: "whsec_fake",
        memberPriceId: "price_member_fake",
      }),
    );

    expect(pluginIds(withStripe)).toContain("stripe");
    // Adding Stripe never removes or reorders any pre-existing plugin.
    expect(pluginIds(withStripe).slice(0, pluginIds(noStripe).length)).toEqual(pluginIds(noStripe));
    expect(pluginIds(withStripe).length).toBe(pluginIds(noStripe).length + 1);

    const stripePlugin = withStripe.options.plugins?.find((p) => p.id === "stripe") as
      | { options?: { subscription?: { plans?: Array<{ name: string; priceId?: string }> } } }
      | undefined;
    expect(stripePlugin).toBeDefined();
    expect(stripePlugin?.options?.subscription?.plans).toEqual([
      { name: "member", priceId: "price_member_fake" },
    ]);
  });

  test("never calls the real Stripe API: constructing the plugin is synchronous, no network I/O", () => {
    // If this test hangs or throws a network error, something started
    // talking to Stripe — it should not for merely building the auth object.
    expect(() =>
      createPlatformAuth(
        baseOpts({
          secretKey: "sk_test_fake",
          webhookSecret: "whsec_fake",
          memberPriceId: "price_fake",
        }),
      ),
    ).not.toThrow();
  });
});
