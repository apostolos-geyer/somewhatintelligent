// Guestlist stub for vitest — a WorkerEntrypoint named `Guestlist`, mirroring
// the real entrypoint: one binding serves HTTP (`fetch`, for the /api
// passthrough mount) AND the RPC `getSession({cookie})` bouncer's package-side
// session resolver calls (see @somewhatintelligent/bouncer/src/session.ts).
// Prior to the package migration this was a plain `export default { fetch }`
// with no RPC surface — `"entrypoint": "Guestlist"` on the wrangler.jsonc
// GUESTLIST service binding is what makes the RPC method callable at all.
//
// Mock stub workers are loaded directly by miniflare (no Vite resolution), so
// they can't import @si/config. Branch on the prefix-independent token cookie
// SUFFIX (session_token, better-auth's own literal name) + the sentinel value
// the test sets, instead of hardcoding the brand cookie PREFIX:
//
//   cookie: …session_token=STALE → returns user u_42 + Set-Cookie refresh
//   cookie: …session_token=THROW → throws (fail-open path)
//   default                      → { session: null, setCookies: [] }
import { WorkerEntrypoint } from "cloudflare:workers";

export class Guestlist extends WorkerEntrypoint {
  // Mirrors the real entrypoint: one binding serves HTTP + RPC.
  async fetch(request) {
    return httpFetch(request);
  }

  async getSession({ cookie }) {
    if (cookie?.includes("session_token=THROW")) {
      throw new Error("guestlist stub: deliberate throw");
    }
    if (cookie?.includes("session_token=STALE")) {
      // Derive the cookie prefix from the incoming token cookie so the
      // refresh Set-Cookie uses the same `<prefix>.session_data` name
      // without hardcoding it.
      const m = cookie.match(/(?:^|;\s*)((?:__Secure-)?[^=;\s]*\.)session_token=STALE/);
      const prefix = m ? m[1] : "";
      return {
        session: {
          user: { id: "u_42", role: "user", name: "Stale User", email: "x@y.z" },
          session: { id: "s1", userId: "u_42", expiresAt: new Date("2999-01-01T00:00:00Z") },
        },
        setCookies: [`${prefix}session_data=NEW_VALUE; Path=/; HttpOnly`],
      };
    }
    return { session: null, setCookies: [] };
  }
}

function httpFetch(request) {
  const cookie = request.headers.get("cookie") ?? "";

  if (cookie.includes("session_token=THROW")) {
    throw new Error("guestlist stub: deliberate throw");
  }

  if (cookie.includes("session_token=STALE")) {
    const m = cookie.match(/(?:^|;\s*)((?:__Secure-)?[^=;\s]*\.)session_token=STALE/);
    const prefix = m ? m[1] : "";
    return new Response(
      JSON.stringify({
        session: { id: "s1", token: "t" },
        user: { id: "u_42", email: "x@y.z" },
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie": `${prefix}session_data=NEW_VALUE; Path=/; HttpOnly`,
        },
      },
    );
  }

  return new Response(JSON.stringify({ data: null }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request) {
    return httpFetch(request);
  },
};
