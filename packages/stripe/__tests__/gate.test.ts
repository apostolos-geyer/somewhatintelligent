import { describe, expect, test } from "vitest";
import { stripeConfigured } from "../src/gate";

describe("stripeConfigured", () => {
  test("true only when both the secret key and webhook secret are present", () => {
    expect(stripeConfigured("sk_x", "whsec_x")).toBe(true);
  });

  test("false when either secret is missing", () => {
    expect(stripeConfigured(undefined, "whsec_x")).toBe(false);
    expect(stripeConfigured("sk_x", undefined)).toBe(false);
    expect(stripeConfigured(undefined, undefined)).toBe(false);
  });

  test("empty strings count as unconfigured", () => {
    expect(stripeConfigured("", "whsec_x")).toBe(false);
    expect(stripeConfigured("sk_x", "")).toBe(false);
    expect(stripeConfigured("", "")).toBe(false);
  });

  // Parity with the deliberately-not-hoisted inline copy in
  // packages/auth/src/server.ts (`stripeConfig?.secretKey &&
  // stripeConfig.webhookSecret`). If the two ever diverge, this fails loudly.
  test("matches the plain Boolean(a && b) semantics the auth copy relies on", () => {
    const inputs: Array<string | undefined> = ["sk", "", undefined];
    for (const a of inputs) {
      for (const b of inputs) {
        expect(stripeConfigured(a, b)).toBe(Boolean(a && b));
      }
    }
  });
});
