/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Inject hygiene (FR-6/7): fail-closed allowlist ordering, strip+stamp,
// passthrough, grant tagging, body caps.
import { runInDurableObject } from "cloudflare:test";
import { MAX_INJECT_REQUEST_BODY } from "../src/types";
import * as grantsM from "../src/methods/grants";
import * as spendM from "../src/methods/spend";
import { makeVault, META, tenantStubFor, uniqueTenant } from "./helpers";
import { echoApi, installUpstream, type Upstream } from "./upstream-mock";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({ "api.vercel.com": echoApi });
});
afterEach(() => upstream.restore());

const KEY = "vercel-key-SECRET-77";

async function putVercel(tenantId: string) {
  const r = await grantsM.put(
    makeVault(),
    { tenantId, dest: "vercel", label: "main", material: { kind: "api_key", apiKey: KEY } },
    META,
  );
  expect(r.ok).toBe(true);
}

describe("inject", () => {
  test("stamps the header template and strips caller credential headers", async () => {
    const tenantId = uniqueTenant();
    await putVercel(tenantId);
    const r = await spendM.inject(
      makeVault(),
      {
        tenantId,
        dest: "vercel",
        request: {
          url: "https://api.vercel.com/v9/projects",
          method: "GET",
          headers: {
            authorization: "Bearer attacker-supplied",
            cookie: "session=steal-me",
            "x-api-key": "smuggled",
            "proxy-authorization": "Basic smuggled",
            "x-custom": "kept",
          },
        },
      },
      META,
    );
    expect(r.ok).toBe(true);
    const [req] = upstream.to("api.vercel.com");
    expect(req).toBeDefined();
    // The stored credential is stamped; nothing caller-supplied survives.
    expect(req!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req!.headers.cookie).toBeUndefined();
    expect(req!.headers["x-api-key"]).toBeUndefined();
    expect(req!.headers["proxy-authorization"]).toBeUndefined();
    expect(req!.headers["x-custom"]).toBe("kept");
  });

  test("passes through method, body, status, headers — and tags the grant", async () => {
    const tenantId = uniqueTenant();
    await putVercel(tenantId);
    const r = await spendM.inject(
      makeVault(),
      {
        tenantId,
        dest: "vercel",
        request: {
          url: "https://api.vercel.com/v9/projects",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "demo" }),
        },
      },
      META,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.status).toBe(200);
    expect(r.value.headers["x-upstream"]).toBe("echo");
    expect(r.value.headers["x-vault-grant"]).toBe("vercel/main");
    const parsed = JSON.parse(new TextDecoder().decode(r.value.body)) as {
      method: string;
      echo: string;
    };
    expect(parsed.method).toBe("POST");
    expect(JSON.parse(parsed.echo)).toEqual({ name: "demo" });
  });

  test("off-allowlist host fails closed BEFORE any key material is touched (FR-7)", async () => {
    const tenantId = uniqueTenant();
    await putVercel(tenantId);
    // Corrupt the ciphertext: if inject ordered decrypt before the host
    // check, this spend would surface grant_unhealthy. It must not.
    await runInDurableObject(tenantStubFor(tenantId), async (_i, state) => {
      state.storage.sql.exec("UPDATE grants SET ciphertext = X'0000000000000000'");
    });
    for (const url of [
      "https://evil.example.com/exfil",
      "http://api.vercel.com/v9/projects", // https only
      "https://api.vercel.com.evil.com/x", // suffix trick
      "not a url",
    ]) {
      const r = await spendM.inject(
        makeVault(),
        { tenantId, dest: "vercel", request: { url } },
        META,
      );
      expect(!r.ok && r.error).toBe("host_not_allowed");
    }
    expect(upstream.recorded).toHaveLength(0);
    // The grant was never decrypted: health untouched.
    const listed = await grantsM.list(makeVault(), { tenantId, dest: "vercel" }, META);
    expect(listed.ok && listed.value[0]!.health).toBe("ok");
  });

  test("request bodies over the cap are refused without an upstream call", async () => {
    const tenantId = uniqueTenant();
    await putVercel(tenantId);
    const r = await spendM.inject(
      makeVault(),
      {
        tenantId,
        dest: "vercel",
        request: {
          url: "https://api.vercel.com/v9/upload",
          method: "POST",
          body: new Uint8Array(MAX_INJECT_REQUEST_BODY + 1),
        },
      },
      META,
    );
    expect(!r.ok && r.error).toBe("body_too_large");
    expect(upstream.recorded).toHaveLength(0);
  });
});
