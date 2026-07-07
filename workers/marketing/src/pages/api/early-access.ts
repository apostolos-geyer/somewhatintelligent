import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";

// Server-rendered (the rest of the marketing site is prerendered static).
export const prerender = false;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Early-access capture for the marketing email forms. POST { email, source? }.
 * Stores into the marketing D1 (`early_access`), deduping on email. The forms
 * call this on submit; success flips them to the "you're on the list" state.
 *
 * Astro v6 removed `Astro.locals.runtime.env` — worker bindings come from
 * `cloudflare:workers`.
 */
export const POST: APIRoute = async ({ request }) => {
  // Per-IP rate limit (anti-spam). cf-connecting-ip is the only signal for an
  // anonymous form; the limiter is per-Cloudflare-location + permissive, but
  // enough to stop a single client flooding the endpoint. 5 / 60s.
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  const limiter = env.EARLY_ACCESS_RL;
  if (limiter) {
    const { success } = await limiter.limit({ key: `early-access:${ip}` });
    if (!success) return json({ error: "rate limited" }, 429);
  }

  let body: { email?: unknown; source?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = typeof body.source === "string" ? body.source.slice(0, 40) : null;

  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ error: "invalid email" }, 400);
  }

  const db = env.DB;
  if (!db) {
    console.error("[early-access] no DB binding");
    return json({ error: "unavailable" }, 503);
  }

  try {
    await db
      .prepare("INSERT OR IGNORE INTO early_access (email, source, created_at) VALUES (?, ?, ?)")
      .bind(email, source, Date.now())
      .run();
    return json({ ok: true }, 200);
  } catch (e) {
    console.error("[early-access] insert failed", e);
    return json({ error: "insert failed" }, 500);
  }
};

function json(payload: unknown, status: number): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}
