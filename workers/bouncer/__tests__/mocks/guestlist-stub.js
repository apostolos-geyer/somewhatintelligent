// Guestlist stub for vitest. Branches on the incoming Cookie header so tests
// don't need to share globals across the worker isolate boundary.
//
// Mock stub workers are loaded directly by miniflare (no Vite resolution), so
// they can't import @greenroom/config. Instead of hardcoding the brand cookie
// PREFIX, branch on the prefix-independent token cookie SUFFIX (session_token,
// which is better-auth's own literal name) + the sentinel value the test sets.
// The wire token cookie is `<prefix>.session_token`; matching `session_token=STALE`
// is correct for any prefix the rebrandable test feeds in.
//
//   cookie: …session_token=STALE  → returns user u_42 + Set-Cookie refresh
//   cookie: …session_token=THROW  → throws (fail-open path)
//   default                       → returns { data: null }
//
// The Set-Cookie carries no prefix-derived name (session_data refresh); the
// session.test.ts assertion derives the full name from config and matches the
// `session_data=NEW_VALUE` suffix. We mirror the incoming token cookie's prefix
// onto the data cookie so the wire name stays internally consistent.
export default {
  async fetch(request) {
    const cookie = request.headers.get("cookie") ?? "";

    if (cookie.includes("session_token=THROW")) {
      throw new Error("guestlist stub: deliberate throw");
    }

    if (cookie.includes("session_token=STALE")) {
      // Derive the cookie prefix from the incoming token cookie so the refresh
      // Set-Cookie uses the same `<prefix>.session_data` name without hardcoding it.
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
  },
};
