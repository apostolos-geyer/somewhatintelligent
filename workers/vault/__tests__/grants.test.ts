/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Grant CRUD semantics: put validation + env rules (FR-1/19), del contract
// (FR-3), list metadata (FR-4).
import * as grantsM from "../src/methods/grants";
import { makeVault, META, uniqueTenant } from "./helpers";
import { installUpstream, type Upstream } from "./upstream-mock";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({
    "api.github.com": () => new Response(null, { status: 204 }),
  });
});
afterEach(() => upstream.restore());

describe("put", () => {
  test("stores and lists a labeled grant (metadata only)", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    const r = await grantsM.put(
      vault,
      {
        tenantId,
        dest: "stripe",
        label: "sandbox",
        material: { kind: "api_key", apiKey: "sk_test_abc" },
      },
      META,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      dest: "stripe",
      label: "sandbox",
      env: "test", // inferred from sk_test_ prefix (FR-1)
      kind: "api_key",
      health: "ok",
      isDefault: false,
    });
    const listed = await grantsM.list(vault, { tenantId, dest: "stripe" }, META);
    expect(listed.ok && listed.value.length).toBe(1);
  });

  test("re-put on the same (dest, label) overwrites in place, same grantId", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    const first = await grantsM.put(
      vault,
      { tenantId, dest: "stripe", label: "s", material: { kind: "api_key", apiKey: "sk_test_1" } },
      META,
    );
    const second = await grantsM.put(
      vault,
      { tenantId, dest: "stripe", label: "s", material: { kind: "api_key", apiKey: "sk_test_2" } },
      META,
    );
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.value.grantId).toBe(first.value.grantId);
  });

  test("env is immutable per grant (FR-19)", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    await grantsM.put(
      vault,
      {
        tenantId,
        dest: "stripe",
        label: "main",
        material: { kind: "api_key", apiKey: "sk_test_1" },
      },
      META,
    );
    const flip = await grantsM.put(
      vault,
      {
        tenantId,
        dest: "stripe",
        label: "main",
        material: { kind: "api_key", apiKey: "sk_live_1" },
      },
      META,
    );
    expect(!flip.ok && flip.error).toBe("env_immutable");
  });

  test("env-sensitive destinations demand a resolvable env (FR-1)", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    const noEnv = await grantsM.put(
      vault,
      { tenantId, dest: "stripe", label: "x", material: { kind: "api_key", apiKey: "opaque-key" } },
      META,
    );
    expect(!noEnv.ok && noEnv.error).toBe("env_required");
    const declared = await grantsM.put(
      vault,
      {
        tenantId,
        dest: "stripe",
        label: "x",
        material: { kind: "api_key", apiKey: "opaque-key" },
        env: "test",
      },
      META,
    );
    expect(declared.ok && declared.value.env).toBe("test");
    const contradiction = await grantsM.put(
      vault,
      {
        tenantId,
        dest: "stripe",
        label: "y",
        material: { kind: "api_key", apiKey: "sk_live_z" },
        env: "test",
      },
      META,
    );
    expect(!contradiction.ok && contradiction.error).toBe("env_mismatch");
  });

  test("rejects wrong material kind, bad labels, unknown/disabled dests", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    const wrongKind = await grantsM.put(
      vault,
      { tenantId, dest: "github", label: "x", material: { kind: "api_key", apiKey: "k" } },
      META,
    );
    expect(!wrongKind.ok && wrongKind.error).toBe("material_mismatch");
    const badLabel = await grantsM.put(
      vault,
      { tenantId, dest: "vercel", label: "Bad Label!", material: { kind: "api_key", apiKey: "k" } },
      META,
    );
    expect(!badLabel.ok && badLabel.error).toBe("label_invalid");
    const unknown = await grantsM.put(
      vault,
      { tenantId, dest: "nope", label: "x", material: { kind: "api_key", apiKey: "k" } },
      META,
    );
    expect(!unknown.ok && unknown.error).toBe("dest_unknown");
    const disabled = await grantsM.put(
      vault,
      { tenantId, dest: "cloudflare", label: "x", material: { kind: "api_key", apiKey: "k" } },
      META,
    );
    expect(!disabled.ok && disabled.error).toBe("dest_disabled");
  });
});

describe("del", () => {
  test("without a label deletes nothing and returns the labels that exist (FR-3)", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    for (const label of ["a", "b"]) {
      await grantsM.put(
        vault,
        { tenantId, dest: "vercel", label, material: { kind: "api_key", apiKey: `k-${label}` } },
        META,
      );
    }
    const r = await grantsM.del(vault, { tenantId, dest: "vercel" }, META);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({ deleted: false, labels: ["a", "b"] });
    const listed = await grantsM.list(vault, { tenantId, dest: "vercel" }, META);
    expect(listed.ok && listed.value.length).toBe(2);
  });

  test("with a label destroys the grant; idempotent on repeat", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    await grantsM.put(
      vault,
      { tenantId, dest: "vercel", label: "a", material: { kind: "api_key", apiKey: "k" } },
      META,
    );
    const first = await grantsM.del(vault, { tenantId, dest: "vercel", label: "a" }, META);
    expect(first.ok && (first.value as { deleted: boolean }).deleted).toBe(true);
    const again = await grantsM.del(vault, { tenantId, dest: "vercel", label: "a" }, META);
    expect(again.ok && (again.value as { deleted: boolean }).deleted).toBe(true);
    const listed = await grantsM.list(vault, { tenantId, dest: "vercel" }, META);
    expect(listed.ok && listed.value.length).toBe(0);
  });

  test("revokes upstream where the registry defines a revoke endpoint", async () => {
    const vault = makeVault();
    const tenantId = uniqueTenant();
    await grantsM.put(
      vault,
      {
        tenantId,
        dest: "github",
        label: "main",
        material: { kind: "oauth", accessToken: "gho_tok", refreshToken: "r1" },
      },
      META,
    );
    const r = await grantsM.del(vault, { tenantId, dest: "github", label: "main" }, META);
    expect(r.ok && (r.value as { revokedUpstream: boolean }).revokedUpstream).toBe(true);
    const revokes = upstream.to("api.github.com");
    expect(revokes).toHaveLength(1);
    expect(revokes[0]!.method).toBe("DELETE");
    // client_id substituted from the configured var, basic auth attached
    expect(revokes[0]!.url).toContain("/applications/test-github-client-id/grant");
    expect(revokes[0]!.headers.authorization).toMatch(/^Basic /);
  });
});
