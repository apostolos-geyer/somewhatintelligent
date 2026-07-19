/**
 * Emits a Content-Security-Policy on every HTML response (INV-SITE-1 hardening,
 * RFC-0001 D14 render-safety). Astro compiles each `<script>` island to an
 * external same-origin module (`/_astro/*.js`), so `script-src 'self'` covers
 * them with no inline-script allowance; scoped `<style>` blocks render inline,
 * so `style-src` keeps `'unsafe-inline'`.
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

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: https://*.stripe.com",
  "font-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' https://js.stripe.com https://maps.googleapis.com",
  "connect-src 'self' https://api.stripe.com https://maps.googleapis.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com https://m.stripe.network",
].join("; ");

export const onRequest = defineMiddleware(async (_context, next) => {
  const response = await next();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/html")) {
    response.headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  }
  return response;
});
