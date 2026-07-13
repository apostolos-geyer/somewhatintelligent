import { describe, expect, test } from "vitest";
import {
  LOCAL_BETTER_AUTH_SECRET,
  LOCAL_BNC_ATT_PRIV,
  LOCAL_VAULT_KEK_V1,
  LOCAL_VAULT_STATE_HMAC,
} from "../../../scripts/dev-config";
import { ATT_KID, DEV_DEFAULTS, SECRETS, sourceFor, workerName } from "../src/manifest";

const byName = (name: string) => {
  const spec = SECRETS.find((s) => s.name === name);
  if (spec === undefined) throw new Error(`missing spec ${name}`);
  return spec;
};

describe("workerName", () => {
  test("applies the fork prefix + env suffix", () => {
    expect(workerName("guestlist", "staging")).toBe("si-guestlist-staging");
    expect(workerName("bouncer", "production")).toBe("si-bouncer-production");
    expect(workerName("store", "staging")).toBe("si-store-staging");
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
    expect(DEV_DEFAULTS.VAULT_KEK_V1).toBe(LOCAL_VAULT_KEK_V1);
    expect(DEV_DEFAULTS.VAULT_STATE_HMAC).toBe(LOCAL_VAULT_STATE_HMAC);
  });
});

describe("vault secrets", () => {
  test("KEK + state HMAC are required generated 32-byte secrets in every env", () => {
    for (const name of ["VAULT_KEK_V1", "VAULT_STATE_HMAC"]) {
      expect(byName(name)).toMatchObject({
        required: true,
        kind: { type: "generated", algo: "random32" },
        perEnv: { local: ["vault"], staging: ["vault"], production: ["vault"] },
      });
      expect(sourceFor(byName(name), "local")).toBe("devDefault");
      expect(sourceFor(byName(name), "staging")).toBe("generate");
      expect(sourceFor(byName(name), "production")).toBe("generate");
    }
  });
  test("GitHub OAuth client creds are optional provided secrets", () => {
    expect(byName("VAULT_GITHUB_CLIENT_ID").required).toBe(false);
    expect(byName("VAULT_GITHUB_CLIENT_SECRET").required).toBe(false);
  });
});

describe("pruned product secrets stay gone", () => {
  test("RTK_API_TOKEN (RealtimeKit) left with the sprout product", () => {
    expect(SECRETS.find((s) => s.name === "RTK_API_TOKEN")).toBeUndefined();
    expect(SECRETS.find((s) => s.name === "RTK_APP_ID")).toBeUndefined();
  });
});

describe("Stripe secrets", () => {
  test("are optional and shared by guestlist subscriptions plus store commerce", () => {
    expect(byName("STRIPE_SECRET_KEY")).toMatchObject({
      required: false,
      perEnv: {
        local: ["guestlist", "store"],
        staging: ["guestlist", "store"],
        production: ["guestlist", "store"],
      },
    });
    expect(byName("STRIPE_WEBHOOK_SIGNING_SECRET")).toMatchObject({
      required: false,
      perEnv: {
        local: ["guestlist", "store"],
        staging: ["guestlist", "store"],
        production: ["guestlist", "store"],
      },
    });
  });
});
