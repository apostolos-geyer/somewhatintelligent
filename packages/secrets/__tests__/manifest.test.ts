import { describe, expect, test } from "vitest";
import { LOCAL_BETTER_AUTH_SECRET, LOCAL_BNC_ATT_PRIV } from "../../../scripts/dev-config";
import { ATT_KID, DEV_DEFAULTS, SECRETS, sourceFor, workerName } from "../src/manifest";

const byName = (name: string) => {
  const spec = SECRETS.find((s) => s.name === name);
  if (spec === undefined) throw new Error(`missing spec ${name}`);
  return spec;
};

describe("workerName", () => {
  test("applies the fork prefix + env suffix", () => {
    expect(workerName("guestlist", "staging")).toBe("sprout-guestlist-staging");
    expect(workerName("bouncer", "production")).toBe("sprout-bouncer-production");
  });
});

describe("sourceFor", () => {
  const auth = byName("BETTER_AUTH_SECRET");
  const att = byName("BNC_ATT_PRIV");
  const resend = byName("RESEND_API_KEY");

  test("local: generated secrets use the committed dev defaults", () => {
    expect(sourceFor(auth, "local")).toBe("devDefault");
    expect(sourceFor(att, "local")).toBe("devDefault");
  });
  test("staging: auth is generated, attestation reuses the dev key (kid=dev)", () => {
    expect(sourceFor(auth, "staging")).toBe("generate");
    expect(sourceFor(att, "staging")).toBe("devDefault");
  });
  test("production: both are generated", () => {
    expect(sourceFor(auth, "production")).toBe("generate");
    expect(sourceFor(att, "production")).toBe("generate");
  });
  test("provided secrets are always provided", () => {
    expect(sourceFor(resend, "staging")).toBe("provided");
  });
});

describe("ATT_KID", () => {
  test("staging signs with the dev kid; production with its own", () => {
    expect(ATT_KID.staging).toBe("dev");
    expect(ATT_KID.production).toBe("production");
  });
});

describe("dev defaults stay in lockstep with scripts/dev-config", () => {
  test("the committed dev secret material matches", () => {
    expect(DEV_DEFAULTS.BETTER_AUTH_SECRET).toBe(LOCAL_BETTER_AUTH_SECRET);
    expect(DEV_DEFAULTS.BNC_ATT_PRIV).toBe(LOCAL_BNC_ATT_PRIV);
  });
});

describe("RealtimeKit (sprout call rooms) secret", () => {
  const apiToken = byName("RTK_API_TOKEN");

  test("RTK_API_TOKEN is provided (operator-supplied, never generated)", () => {
    expect(apiToken.kind).toEqual({ type: "provided" });
    expect(sourceFor(apiToken, "production")).toBe("provided");
  });

  test("scoped to sprout for staging + production only — never local (RealtimeKit has no offline mode)", () => {
    expect(apiToken.perEnv.local).toBeUndefined();
    expect(apiToken.perEnv.staging).toEqual(["sprout"]);
    expect(apiToken.perEnv.production).toEqual(["sprout"]);
    // Optional in every targeted env so the seam degrades to { available:false }
    // rather than hard-failing provisioning when absent.
    expect(apiToken.required).toBe(false);
  });

  test("RTK_APP_ID is NOT a secret — it's a non-secret wrangler var (deploy.ts → rtk)", () => {
    expect(SECRETS.find((s) => s.name === "RTK_APP_ID")).toBeUndefined();
  });
});
