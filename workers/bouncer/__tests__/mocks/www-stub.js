// WWW stub for vitest. Branches on URL pathname so tests can elicit
// specific upstream behavior without crossing the worker isolate boundary.
//
//   /api/json     → JSON body, application/json
//   /api/redirect → 302 Location: /somewhere
//   default       → minimal HTML
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/json")) {
      return new Response(JSON.stringify({ hello: "world" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname.startsWith("/api/redirect")) {
      return new Response(null, {
        status: 302,
        headers: { location: "/somewhere" },
      });
    }

    return new Response(
      `<!doctype html><html><head></head><body><p>www stub: ${url.pathname}</p></body></html>`,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  },
};
