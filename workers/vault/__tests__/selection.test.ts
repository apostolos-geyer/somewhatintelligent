/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Grant selection + environment safety rails (FR-16/17/18): ambiguity is a
// hard error, live is never implicit, no cross-label fallback.
import { runInDurableObject } from "cloudflare:test";
import * as grantsM from "../src/methods/grants";
import * as spendM from "../src/methods/spend";
import { makeVault, META, tenantStubFor, uniqueTenant } from "./helpers";
import { echoApi, installUpstream, type Upstream } from "./upstream-mock";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({ "api.stripe.com": echoApi });
});
afterEach(() => upstream.restore());

const STRIPE_REQ = { url: "https://api.stripe.com/v1/charges", method: "GET" };

async function putStripe(tenantId: string, label: string, key: string) {
  const vault = makeVault();
  const r = await grantsM.put(
    vault,
    { tenantId, dest: "stripe", label, material: { kind: "api_key", apiKey: key } },
    META,
  );
  expect(r.ok).toBe(true);
}

describe("selection semantics", () => {
  test("label omitted with two grants and no default → grant_ambiguous naming both", async () => {
    const tenantId = uniqueTenant();
    await putStripe(tenantId, "sandbox", "sk_test_1");
    await putStripe(tenantId, "sandbox-b", "sk_test_2");
    const r = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", request: STRIPE_REQ },
      META,
    );
    expect(!r.ok && r.error).toBe("grant_ambiguous");
    if (r.ok) return;
    expect(r.labels).toEqual(["sandbox", "sandbox-b"]);
    expect(upstream.recorded).toHaveLength(0);
  });

  test("label omitted with a single test grant resolves implicitly", async () => {
    const tenantId = uniqueTenant();
    await putStripe(tenantId, "sandbox", "sk_test_1");
    const r = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", request: STRIPE_REQ },
      META,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.headers["x-vault-grant"]).toBe("stripe/sandbox");
  });

  test("a lone LIVE grant is never selected implicitly (FR-17)", async () => {
    const tenantId = uniqueTenant();
    await putStripe(tenantId, "prod", "sk_live_1");
    const r = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", request: STRIPE_REQ },
      META,
    );
    expect(!r.ok && r.error).toBe("live_requires_explicit_label");
    expect(upstream.recorded).toHaveLength(0);
    const explicit = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", label: "prod", request: STRIPE_REQ },
      META,
    );
    expect(explicit.ok).toBe(true);
    if (explicit.ok) expect(explicit.value.headers["x-vault-grant"]).toBe("stripe/prod");
  });

  test("a default set to a test grant makes implicit spends use it", async () => {
    const tenantId = uniqueTenant();
    await putStripe(tenantId, "sandbox", "sk_test_1");
    await putStripe(tenantId, "sandbox-b", "sk_test_2");
    const set = await grantsM.setDefault(
      makeVault(),
      { tenantId, dest: "stripe", label: "sandbox-b" },
      META,
    );
    expect(set.ok).toBe(true);
    const r = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", request: STRIPE_REQ },
      META,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.headers["x-vault-grant"]).toBe("stripe/sandbox-b");
  });

  test("pointing the default at a live grant requires confirmLive (FR-17)", async () => {
    const tenantId = uniqueTenant();
    await putStripe(tenantId, "sandbox", "sk_test_1");
    await putStripe(tenantId, "prod", "sk_live_1");
    const refused = await grantsM.setDefault(
      makeVault(),
      { tenantId, dest: "stripe", label: "prod" },
      META,
    );
    expect(!refused.ok && refused.error).toBe("confirm_live_required");
    const confirmed = await grantsM.setDefault(
      makeVault(),
      { tenantId, dest: "stripe", label: "prod", confirmLive: true },
      META,
    );
    expect(confirmed.ok).toBe(true);
    // The explicitly-set live default IS reachable implicitly now.
    const r = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", request: STRIPE_REQ },
      META,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.headers["x-vault-grant"]).toBe("stripe/prod");
  });

  test("an unhealthy grant fails with that fact — the sibling is never consulted (FR-18)", async () => {
    const tenantId = uniqueTenant();
    await putStripe(tenantId, "sandbox", "sk_test_1");
    await putStripe(tenantId, "prod", "sk_live_1");
    // Tamper sandbox's ciphertext at rest → first spend marks it unhealthy.
    await runInDurableObject(tenantStubFor(tenantId), async (_i, state) => {
      state.storage.sql.exec(
        "UPDATE grants SET ciphertext = X'00000000000000000000' WHERE label = 'sandbox'",
      );
    });
    const first = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", label: "sandbox", request: STRIPE_REQ },
      META,
    );
    expect(!first.ok && first.error).toBe("grant_unhealthy");
    // Second spend fails at selection with the recorded reason.
    const second = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", label: "sandbox", request: STRIPE_REQ },
      META,
    );
    expect(!second.ok && second.error).toBe("grant_unhealthy");
    if (!second.ok) expect(second.message).toContain("tampered");
    // The failing sandbox call never became a live call: zero upstream hits,
    // and the live grant was never touched.
    expect(upstream.recorded).toHaveLength(0);
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "stripe" }, META);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const prod = listed.value.find((g) => g.label === "prod");
    expect(prod?.lastUsedAt).toBeNull();
    const sandbox = listed.value.find((g) => g.label === "sandbox");
    expect(sandbox).toMatchObject({ health: "unhealthy", unhealthyReason: "tampered" });
  });

  test("grant_missing names the labels that do exist", async () => {
    const tenantId = uniqueTenant();
    await putStripe(tenantId, "sandbox", "sk_test_1");
    const r = await spendM.inject(
      makeVault(),
      { tenantId, dest: "stripe", label: "nope", request: STRIPE_REQ },
      META,
    );
    expect(!r.ok && r.error).toBe("grant_missing");
    if (!r.ok) expect(r.labels).toEqual(["sandbox"]);
  });
});
