import { describe, expect, test } from "vite-plus/test";
import { PLATFORM_HEADERS } from "@si/auth";
import { platformDeployConfig } from "@si/config";
import { createDevEnvelopeStamper } from "../dev-envelope";

// Dev chat host is brand-derived: rebrands change `devDomain` in config.
const chatDevHost = `chat.${platformDeployConfig.devDomain}`;

// Well-known dev keypair from `scripts/dev-config.ts` — pub half lives in
// `packages/config/src/bouncer-attestation.ts` under `kid: "dev"`. Safe to
// inline here for tests; this is the same key bouncer's dev `.dev.vars` uses.
const DEV_PRIV_PEM = `-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEINzNgiuDD9xbqVEPkfMt8twPcq7hTnIbAdKKHPjM7TmU
-----END PRIVATE KEY-----`;

const userFixture = {
  id: "user_test",
  role: "member",
  name: "Alice",
  email: "alice@example.com",
  image: null,
};
const sessionFixture = {
  id: "sess_test",
  userId: "user_test",
  expiresAt: new Date(Date.now() + 60_000),
};

function makeGuestlist(opts: {
  session?: { user: typeof userFixture; session: typeof sessionFixture } | null;
  calls?: { count: number };
}) {
  return (_req: Request) => ({
    getSession: async () => {
      if (opts.calls) opts.calls.count += 1;
      return opts.session ?? null;
    },
  });
}

describe("createDevEnvelopeStamper", () => {
  test("non-dev env → hard no-op (request returned by identity, no cookies)", async () => {
    const calls = { count: 0 };
    for (const envLabel of ["production", "staging", "preview", undefined]) {
      const stamper = createDevEnvelopeStamper({
        getEnvironment: () => envLabel,
        getSigner: () => {
          throw new Error("signer must not be invoked outside dev");
        },
        getGuestlist: makeGuestlist({ session: null, calls }),
      });
      const req = new Request("https://chat.example/");
      const out = await stamper(req);
      expect(out.request).toBe(req);
      expect(out.setCookies).toEqual([]);
    }
    expect(calls.count).toBe(0);
  });

  test("dev + existing envelope header → passthrough (no remint)", async () => {
    let signerCalls = 0;
    const stamper = createDevEnvelopeStamper({
      getEnvironment: () => "development",
      getSigner: () => {
        signerCalls += 1;
        return { privPem: DEV_PRIV_PEM, kid: "dev" };
      },
      getGuestlist: makeGuestlist({ session: null }),
    });
    const req = new Request("https://chat.example/", {
      headers: { [PLATFORM_HEADERS.att]: "preexisting.jws.value" },
    });
    const out = await stamper(req);
    expect(out.request).toBe(req);
    expect(out.request.headers.get(PLATFORM_HEADERS.att)).toBe("preexisting.jws.value");
    expect(out.setCookies).toEqual([]);
    expect(signerCalls).toBe(0);
  });

  test("dev + no envelope + authed session → stamps a JWS-compact envelope", async () => {
    const stamper = createDevEnvelopeStamper({
      getEnvironment: () => "development",
      getSigner: () => ({ privPem: DEV_PRIV_PEM, kid: "dev" }),
      getGuestlist: makeGuestlist({
        session: { user: userFixture, session: sessionFixture },
      }),
    });
    const req = new Request("https://chat.example/whatever");
    const out = await stamper(req);
    expect(out.request).not.toBe(req);
    const att = out.request.headers.get(PLATFORM_HEADERS.att);
    expect(att).toBeTruthy();
    const parts = att!.split(".");
    expect(parts).toHaveLength(3);
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
    expect(payload.iss).toBe("bouncer");
    expect(payload.host).toBe("chat.example");
    expect(payload.actor).toMatchObject({
      kind: "user",
      id: "user_test",
      role: "member",
      name: "Alice",
      email: "alice@example.com",
    });
    expect(payload.session).toMatchObject({ id: "sess_test", userId: "user_test" });
  });

  test("dev + no envelope + no session → still mints a signed envelope with actor:null", async () => {
    const stamper = createDevEnvelopeStamper({
      getEnvironment: () => "development",
      getSigner: () => ({ privPem: DEV_PRIV_PEM, kid: "dev" }),
      getGuestlist: makeGuestlist({ session: null }),
    });
    const req = new Request("https://chat.example/public");
    const out = await stamper(req);
    const att = out.request.headers.get(PLATFORM_HEADERS.att);
    expect(att).toBeTruthy();
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(att!.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
    expect(payload.actor).toBeNull();
    expect(payload.session).toBeNull();
  });

  test("expectedHost override pins payload.host", async () => {
    const stamper = createDevEnvelopeStamper({
      getEnvironment: () => "development",
      getSigner: () => ({ privPem: DEV_PRIV_PEM, kid: "dev" }),
      getGuestlist: makeGuestlist({ session: null }),
      expectedHost: chatDevHost,
    });
    const req = new Request("http://127.0.0.1:8788/");
    const out = await stamper(req);
    const att = out.request.headers.get(PLATFORM_HEADERS.att)!;
    const payload = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(att.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
          c.charCodeAt(0),
        ),
      ),
    );
    expect(payload.host).toBe(chatDevHost);
  });
});
