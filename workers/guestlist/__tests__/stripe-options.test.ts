import { buildStripeOptions } from "../src/auth-config";
import type { GuestlistEnv } from "../src/guestlist-env";

// Guards the stripeConfigured(secretKey, webhookSecret) arg-order in the
// buildStripeOptions swap (f13): both secrets present → a populated config,
// either missing → undefined (plugin stays out of the auth plugin set).
function env(overrides: Partial<GuestlistEnv>): GuestlistEnv {
  return overrides as unknown as GuestlistEnv;
}

describe("buildStripeOptions", () => {
  it("returns undefined when only the secret key is set", () => {
    expect(buildStripeOptions(env({ STRIPE_SECRET_KEY: "sk_x" }))).toBeUndefined();
  });

  it("returns undefined when only the webhook secret is set", () => {
    expect(buildStripeOptions(env({ STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_x" }))).toBeUndefined();
  });

  it("returns undefined when neither secret is set", () => {
    expect(buildStripeOptions(env({}))).toBeUndefined();
  });

  it("returns a populated config when both secrets are present", () => {
    const opts = buildStripeOptions(
      env({ STRIPE_SECRET_KEY: "sk_x", STRIPE_WEBHOOK_SIGNING_SECRET: "whsec_x" }),
    );
    expect(opts).toMatchObject({ secretKey: "sk_x", webhookSecret: "whsec_x" });
    expect(typeof opts?.memberPriceId).toBe("string");
  });
});
