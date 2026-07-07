import { describe, expect, test } from "vitest";
import { buildPlan } from "../src/resolve";

const find = (plan: ReturnType<typeof buildPlan>, secret: string) => {
  const e = plan.find((entry) => entry.secret === secret);
  if (e === undefined) throw new Error(`no plan entry for ${secret}`);
  return e;
};

describe("buildPlan — local", () => {
  const plan = buildPlan("local", {});

  test("generated secrets are ready from dev defaults, targeting .dev.vars", () => {
    const auth = find(plan, "BETTER_AUTH_SECRET");
    expect(auth.status).toBe("ready");
    expect(auth.target).toBe("workers/guestlist/.dev.vars");
  });
  test("BNC_ATT_PRIV targets bouncer + every dev-envelope-stamping app locally", () => {
    const services = plan
      .filter((e) => e.secret === "BNC_ATT_PRIV")
      .map((e) => e.service)
      .sort();
    // bouncer signs; identity stamps its own dev envelope (no gateway in
    // dev-direct topology), so it needs the dev signing key too.
    expect(services).toEqual(["bouncer", "identity"]);
  });
  test("a provided secret with no value is missing + optional", () => {
    const google = find(plan, "GOOGLE_CLIENT_ID");
    expect(google.status).toBe("missing");
    expect(google.required).toBe(false);
  });
});

describe("buildPlan — staging", () => {
  test("auth will generate; attestation is ready (dev key); targets are workers", () => {
    const plan = buildPlan("staging", {});
    const auth = find(plan, "BETTER_AUTH_SECRET");
    expect(auth.status).toBe("to-generate");
    expect(auth.target).toBe("si-guestlist-staging");
    expect(find(plan, "BNC_ATT_PRIV").status).toBe("ready");
  });
  test("a stored value flips status to ready", () => {
    const plan = buildPlan("staging", { BETTER_AUTH_SECRET: "abc" });
    expect(find(plan, "BETTER_AUTH_SECRET").status).toBe("ready");
  });
});

describe("buildPlan — env-specific targeting", () => {
  test("RESEND_API_KEY is targeted in staging (promoter) but not production", () => {
    expect(buildPlan("staging", {}).some((e) => e.secret === "RESEND_API_KEY")).toBe(true);
    expect(buildPlan("production", {}).some((e) => e.secret === "RESEND_API_KEY")).toBe(false);
  });
  test("production generates both auth + attestation", () => {
    const plan = buildPlan("production", {});
    expect(find(plan, "BETTER_AUTH_SECRET").status).toBe("to-generate");
    expect(find(plan, "BNC_ATT_PRIV").status).toBe("to-generate");
  });
});

describe("buildPlan — filters", () => {
  test("by worker keeps only that service", () => {
    const plan = buildPlan("staging", {}, { service: "promoter" });
    expect(plan.length).toBeGreaterThan(0);
    expect(plan.every((e) => e.service === "promoter")).toBe(true);
  });
  test("by secret keeps only that secret", () => {
    const plan = buildPlan("production", {}, { secret: "BETTER_AUTH_SECRET" });
    expect(plan.every((e) => e.secret === "BETTER_AUTH_SECRET")).toBe(true);
  });
});
