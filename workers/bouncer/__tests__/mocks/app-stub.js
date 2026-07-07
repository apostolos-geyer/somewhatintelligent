// Generic upstream-app stub for vitest. Every app binding (identity,
// chat, quiz) points here — bouncer's
// dispatch/proxy logic doesn't care which app responds, just that a
// service binding resolves and returns a Response.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = { "content-type": "text/html; charset=utf-8" };
    // Echo the attestation envelope so tests can decode what bouncer minted
    // (the stamper-host regression test reads payload.host from this echo).
    const att = request.headers.get("x-platform-att");
    if (att) headers["x-stub-echo-att"] = att;
    return new Response(
      `<!doctype html><html><head></head><body><p>app stub: ${url.pathname}</p></body></html>`,
      { status: 200, headers },
    );
  },
};
