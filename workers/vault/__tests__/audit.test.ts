/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
// Audit (FR-14): every op leaves a typed event; the recent window trims; no
// token material in audit rows or anything the worker logs.
import { runInDurableObject } from "cloudflare:test";
import { audit } from "../src/do/audit";
import type { TenantInstance } from "../src/do/instance";
import * as adminM from "../src/methods/admin";
import * as grantsM from "../src/methods/grants";
import * as spendM from "../src/methods/spend";
import { CALLER_APP, makeVault, META, tenantStubFor, uniqueTenant } from "./helpers";
import { echoApi, installUpstream, type Upstream } from "./upstream-mock";

const SECRET = "sk_test_AUDITSECRETVALUE1234";

let upstream: Upstream;
beforeEach(() => {
  upstream = installUpstream({ "api.stripe.com": echoApi });
});
afterEach(() => upstream.restore());

describe("audit", () => {
  test("ops emit typed events with attribution — and zero secret material anywhere", async () => {
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      });
    }
    try {
      const tenantId = uniqueTenant();
      await grantsM.put(
        makeVault(),
        {
          tenantId,
          dest: "stripe",
          label: "sandbox",
          material: { kind: "api_key", apiKey: SECRET },
        },
        META,
      );
      await spendM.inject(
        makeVault(),
        { tenantId, dest: "stripe", request: { url: "https://api.stripe.com/v1/charges" } },
        META,
      );
      await spendM.inject(
        makeVault(),
        { tenantId, dest: "stripe", request: { url: "https://evil.example.com/x" } },
        META,
      );
      await grantsM.del(makeVault(), { tenantId, dest: "stripe", label: "sandbox" }, META);

      const rows = await adminM.auditRecent(makeVault(), { tenantId }, META);
      expect(rows.ok).toBe(true);
      if (!rows.ok) return;
      const ops = rows.value.map((r) => `${r.op}:${r.outcome}`);
      expect(ops).toContain("put:ok");
      expect(ops).toContain("inject:ok");
      expect(ops).toContain("inject:host_not_allowed");
      expect(ops).toContain("del:ok");
      expect(rows.value.every((r) => r.callerApp === CALLER_APP)).toBe(true);

      const auditDump = JSON.stringify(rows.value);
      expect(auditDump).not.toContain(SECRET);
      expect(auditDump).not.toContain("AUDITSECRET");
      const logDump = logs.join("\n");
      expect(logDump).not.toContain(SECRET);
      expect(logDump).not.toContain("AUDITSECRET");
    } finally {
      vi.restoreAllMocks();
    }
  });

  test("the recent window trims to 500 rows", async () => {
    const tenantId = uniqueTenant();
    await grantsM.put(
      makeVault(),
      { tenantId, dest: "vercel", label: "a", material: { kind: "api_key", apiKey: "k" } },
      META,
    );
    await runInDurableObject(tenantStubFor(tenantId), async (instance) => {
      const self = instance as unknown as TenantInstance;
      for (let i = 0; i < 520; i++) {
        audit(self, { op: "synthetic", outcome: `n${i}` });
      }
    });
    const rows = await adminM.auditRecent(makeVault(), { tenantId, limit: 500 }, META);
    expect(rows.ok).toBe(true);
    if (!rows.ok) return;
    expect(rows.value).toHaveLength(500);
    // Newest-first: the very last synthetic event leads.
    expect(rows.value[0]!.outcome).toBe("n519");
  });
});
