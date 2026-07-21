// Store upstream stub for vitest — headless behind bouncer (RFC-0001
// D11/D12): the buyer checkout/order HTTP API under /api/store and Stripe
// webhook ingress under /hooks/store, both passthrough. Echoes the received
// path so tests can prove the request arrived UNSTRIPPED at Store (and not at
// guestlist's /api, whose stub answers JSON).
export default {
  async fetch(request) {
    const url = new URL(request.url);
    return new Response(`store stub: ${url.pathname}`, {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  },
};
