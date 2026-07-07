import { SELF, env } from "cloudflare:test";

// Multi-host envelope stamping.
//
// getStamper (src/envelope.ts) memoizes the stamper per isolate. The stamper
// derives the host from the request argument passed to resolveHost on every
// stamp, so each envelope carries the host of the request it was minted for
// even when one isolate serves multiple hosts (the apps' verifiers pin
// expectedHost to their own URL and reject a mismatched host).
//
// This test drives TWO hosts through ONE isolate and decodes the envelope
// each upstream stub received (echoed via `x-stub-echo-att` — see
// mocks/app-stub.js): each must carry its own host.
//
// Own file = fresh isolate (module-level stamper cache + configCache).

function decodeEnvelopeHost(att: string): string {
  const payload = att.split(".")[1]!;
  const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))) as {
    host: string;
  };
  return json.host;
}

beforeEach(() => {
  env.ROUTES = JSON.stringify({
    routes: [
      // Two hosts, both envelope-stamped, served by the SAME isolate. IDENTITY
      // resolves to the app-stub in this harness (see vite.config.ts).
      { binding: "IDENTITY", host: "first.test", path: "/", mode: "passthrough" },
      { binding: "IDENTITY", host: "second.test", path: "/", mode: "passthrough" },
    ],
  }) as unknown as Env["ROUTES"];
});

describe("envelope host stamping across hosts in one isolate", () => {
  test("each request's envelope carries ITS OWN host, not the isolate-warming host", async () => {
    // Warm the isolate (and the memoized stamper) on first.test …
    const first = await SELF.fetch("https://first.test/");
    expect(first.status).toBe(200);
    const firstAtt = first.headers.get("x-stub-echo-att");
    expect(firstAtt).toBeTruthy();
    expect(decodeEnvelopeHost(firstAtt!)).toBe("first.test");

    // … then hit a DIFFERENT host in the same isolate: its envelope must
    // carry its own host, not the warming host.
    const second = await SELF.fetch("https://second.test/");
    expect(second.status).toBe(200);
    const secondAtt = second.headers.get("x-stub-echo-att");
    expect(secondAtt).toBeTruthy();
    expect(decodeEnvelopeHost(secondAtt!)).toBe("second.test");

    // And back again — the first host keeps its own identity too.
    const again = await SELF.fetch("https://first.test/sub");
    expect(decodeEnvelopeHost(again.headers.get("x-stub-echo-att")!)).toBe("first.test");
  });
});
