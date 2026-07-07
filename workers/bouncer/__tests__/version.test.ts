import { SELF, env } from "cloudflare:test";

// /__version — bouncer answers its OWN version endpoint BEFORE route
// matching (src/index.ts), so it works on every host it fronts (even one
// whose `/` mount is a redirect), while mounted apps' endpoints remain
// reachable through their mounts (vmf strips the prefix, passthrough
// forwards untouched). Values are ship-time-injected vars
// (WORKER_VERSION/WORKER_COMMIT via scripts/deploy-worker.sh); tests run
// un-injected, so the kit fallbacks are the expected payload.
beforeEach(() => {
  env.ROUTES = {
    routes: [
      { binding: "WWW", host: "platform.test", path: "/api", mode: "passthrough" },
      { binding: "APP1", host: "platform.test", path: "/account", mode: "vmf" },
      { host: "platform.test", path: "/", mode: "redirect", to: "/shop" },
    ],
  } as unknown as Env["ROUTES"];
});

describe("GET /__version", () => {
  test("answers with bouncer's version payload instead of the `/` redirect", async () => {
    const res = await SELF.fetch("https://platform.test/__version", { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as Record<string, string>;
    expect(body.worker).toBe("bouncer");
    // Un-injected in tests — the safe fallbacks are the contract here.
    expect(body.version).toBe("0.0.0-dev");
    expect(body.commit).toBe("unknown");
    expect(typeof body.environment).toBe("string");
    expect(body.environment.length).toBeGreaterThan(0);
  });

  test("answers on a host with NO route table entry (before matching, any host)", async () => {
    const res = await SELF.fetch("https://unrouted.example/__version");
    expect(res.status).toBe(200);
    expect(((await res.json()) as { worker: string }).worker).toBe("bouncer");
  });

  test("POST /__version is not intercepted (falls through to routing)", async () => {
    const res = await SELF.fetch("https://platform.test/__version", {
      method: "POST",
      redirect: "manual",
    });
    // The `/` redirect route owns unmatched paths on this host.
    expect(res.status).toBe(308);
  });

  test("/account/__version reaches the mounted app (vmf strips the prefix)", async () => {
    const res = await SELF.fetch("https://platform.test/account/__version");
    expect(res.status).toBe(200);
    // worker-a-stub echoes the path IT received — bouncer forwarded
    // /__version (mount stripped), it did NOT answer with its own payload.
    expect(await res.text()).toContain("Path: /__version");
  });

  test("/api/__version passes through to the API upstream untouched", async () => {
    const res = await SELF.fetch("https://platform.test/api/__version");
    expect(res.status).toBe(200);
    // www-stub's default branch echoes the untouched path — proof the
    // request went upstream with its /api prefix intact.
    expect(await res.text()).toContain("www stub: /api/__version");
  });
});
