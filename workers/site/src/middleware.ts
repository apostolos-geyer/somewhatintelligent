/**
 * Emits a Content-Security-Policy on HTML responses in staging/production, and
 * skips it in local dev (INV-SITE-1 hardening, RFC-0001 D14 render-safety). Astro
 * compiles each `<script>` island to an external same-origin module
 * (`/_astro/*.js`), so `script-src 'self'` covers them with no inline-script
 * allowance; scoped `<style>` blocks render inline, so `style-src` keeps
 * `'unsafe-inline'`. The dev pipeline injects a bare inline toolbar/HMR script
 * that a strict `script-src 'self'` would reject, so the header is omitted in
 * development (the dev server has no adversary).
 *
 * The Stripe allowances are load-bearing: the /checkout island loads Stripe.js
 * from `js.stripe.com`, mounts Payment/Shipping Elements in `js.stripe.com`
 * iframes (plus the `m.stripe.network` fraud frame and `hooks.stripe.com`),
 * talks to `api.stripe.com`, and the shipping-address autocomplete reaches
 * `maps.googleapis.com`. Dropping any of these breaks checkout.
 *
 * Non-HTML responses (media bytes on /media/:id, JSON on /cart/lookup.json) pass
 * through untouched.
 */
import { defineMiddleware } from "astro:middleware";
import { env } from "cloudflare:workers";

// `frame-ancestors` is `'none'` everywhere except the Operator draft-preview
// route (RFC-0001 D14 / exec-plan T23), which is rendered inside a hidden iframe
// on the Access-protected Operator origin (`desk.*`, or the local operator dev
// server on :8792). Those origins — and nothing else — may frame `/__preview`.
const OPERATOR_FRAME_ANCESTORS =
  "'self' https://desk.somewhatintelligent.ca https://desk-staging.somewhatintelligent.ca " +
  "https://*.somewhatintelligent.localhost http://localhost:8792 http://127.0.0.1:8792";

function contentSecurityPolicy(frameAncestors: string): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "img-src 'self' data: https://*.stripe.com",
    "font-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    "script-src 'self' https://js.stripe.com https://maps.googleapis.com",
    "connect-src 'self' https://api.stripe.com https://maps.googleapis.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com https://m.stripe.network",
  ].join("; ");
}

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  const contentType = response.headers.get("content-type") ?? "";
  // Widened to string: the generated ENVIRONMENT union depends on whether
  // .dev.vars existed at `wrangler types` time (CI regenerates without it).
  const environment: string = env.ENVIRONMENT;
  if (contentType.includes("text/html") && environment !== "development") {
    const isPreview = context.url.pathname === "/__preview";
    response.headers.set(
      "Content-Security-Policy",
      contentSecurityPolicy(isPreview ? OPERATOR_FRAME_ANCESTORS : "'none'"),
    );
  }
  return response;
});
