import { SELF, env } from "cloudflare:test";

// REGRESSION — multi-host envelope stamping.
//
// getStamper (src/envelope.ts) memoizes the stamper per isolate, so the
// `resolveHost` it captures is the one from the FIRST request the isolate
// serves. The old call site passed `() => host` — a closure over that first
// request's hostname — which froze it into every envelope the isolate ever
// minted. Harmless while a bouncer fronted exactly ONE envelope-verified host,
// it breaks the moment one isolate serves multiple hosts: an isolate warmed on
// host A stamps `host: A` into envelopes for host B's requests, and the apps'
// verifiers (which pin expectedHost to their own URL) reject with host_mismatch
// — flip-flopping as isolates recycle.
//
// The fix derives the host from the request ARGUMENT the stamper passes to
// resolveHost on every stamp. This test drives TWO hosts through ONE isolate
// and decodes the envelope each upstream stub received (echoed via
// `x-stub-echo-att` — see mocks/app-stub.js): each must carry its own host.
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
  });
});

describe("envelope host stamping across hosts in one isolate", () => {
  test("each request's envelope carries ITS OWN host, not the isolate-warming host", async () => {
    // Warm the isolate (and the memoized stamper) on first.test …
    const first = await SELF.fetch("https://first.test/");
    expect(first.status).toBe(200);
    const firstAtt = first.headers.get("x-stub-echo-att");
    expect(firstAtt).toBeTruthy();
    expect(decodeEnvelopeHost(firstAtt!)).toBe("first.test");

    // … then hit a DIFFERENT host in the same isolate. Pre-fix this envelope
    // said "first.test" (the frozen warming host) → downstream host_mismatch.
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
