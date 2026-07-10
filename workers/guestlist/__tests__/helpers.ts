/**
 * Test helpers. Fixture values mirror si's config: cookiePrefix
 * `platformConfig.cookies.prefix` ("si") and AUTH_DOMAIN
 * `.somewhatintelligent.ca` (from wrangler.jsonc).
 */
import { env, SELF } from "cloudflare:test";

/** A subdomain of the apex — inside better-auth's trustedOrigins. */
export const GUESTLIST_ORIGIN = "https://guestlist.somewhatintelligent.ca";
export const TEST_EMAIL_DOMAIN = "test.somewhatintelligent.ca";
export const COOKIE_PREFIX = "si";

/**
 * Sign up a user, auto-verify their email via D1, then sign in.
 * Returns session cookies and userId.
 */
export async function signUpVerified(opts: {
  name: string;
  email: string;
  password: string;
}): Promise<{ cookies: string; userId: string }> {
  const signUpRes = await SELF.fetch("http://localhost/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: GUESTLIST_ORIGIN },
    body: JSON.stringify({ name: opts.name, email: opts.email, password: opts.password }),
  });
  const signUpBody = (await signUpRes.json()) as Record<string, unknown>;
  const userId =
    (signUpBody.user as Record<string, unknown>)?.id ?? (signUpBody as Record<string, unknown>).id;
  if (!userId) {
    throw new Error(`Sign-up failed for ${opts.email}: ${JSON.stringify(signUpBody)}`);
  }

  await env.DB.prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
    .bind(userId as string)
    .run();

  const signInRes = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: GUESTLIST_ORIGIN },
    body: JSON.stringify({ email: opts.email, password: opts.password }),
  });
  return { cookies: extractCookies(signInRes), userId: userId as string };
}

/** Sign up a verified user and promote them to admin via D1 (fresh session after). */
export async function signUpAdmin(opts: {
  name: string;
  email: string;
  password: string;
}): Promise<{ cookies: string; userId: string }> {
  const result = await signUpVerified(opts);
  await env.DB.prepare("UPDATE user SET role = 'admin' WHERE id = ?").bind(result.userId).run();
  const signInRes = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: GUESTLIST_ORIGIN },
    body: JSON.stringify({ email: opts.email, password: opts.password }),
  });
  return { cookies: extractCookies(signInRes), userId: result.userId };
}

/** Set-Cookie values folded into a single Cookie header string. */
export function extractCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
}

/** Raw Set-Cookie header strings (for domain/attribute parsing). */
export function getRawSetCookies(res: Response): string[] {
  return res.headers.getSetCookie();
}

let counter = 0;

/** Unique test email to avoid collisions between tests. */
export function uniqueEmail(prefix = "test"): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Insert an OAuth client directly into D1 for test arrangement.
 * Pass `referenceId: "managed:..."` to mark as managed (undeletable).
 */
export async function createOAuthClient(opts: {
  id?: string;
  clientId?: string;
  name: string;
  redirectUris: string[];
  skipConsent?: boolean;
  disabled?: boolean;
  referenceId?: string | null;
  userId?: string | null;
}): Promise<{ id: string; clientId: string }> {
  counter += 1;
  const id = opts.id ?? `cli-${counter}-${Date.now()}`;
  const clientId = opts.clientId ?? `cid-${counter}-${Date.now()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO oauth_client (
      id, client_id, client_secret, disabled, skip_consent,
      user_id, created_at, updated_at, name, redirect_uris, reference_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      clientId,
      "test-secret",
      opts.disabled ? 1 : 0,
      opts.skipConsent ? 1 : 0,
      opts.userId ?? null,
      now,
      now,
      opts.name,
      JSON.stringify(opts.redirectUris),
      opts.referenceId ?? null,
    )
    .run();
  return { id, clientId };
}

/** Insert an OAuth consent directly into D1. */
export async function createOAuthConsent(opts: {
  id?: string;
  clientId: string;
  userId: string;
  scopes: string[];
}): Promise<{ id: string }> {
  counter += 1;
  const id = opts.id ?? `con-${counter}-${Date.now()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO oauth_consent (id, client_id, user_id, scopes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, opts.clientId, opts.userId, JSON.stringify(opts.scopes), now, now)
    .run();
  return { id };
}

/** Insert an OAuth access token directly into D1. */
export async function createOAuthAccessToken(opts: {
  clientId: string;
  userId: string;
  scopes: string[];
}): Promise<{ id: string }> {
  counter += 1;
  const id = `at-${counter}-${Date.now()}`;
  const token = `tok-${counter}-${Date.now()}`;
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO oauth_access_token (id, token, client_id, user_id, expires_at, created_at, scopes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, token, opts.clientId, opts.userId, now + 3600_000, now, JSON.stringify(opts.scopes))
    .run();
  return { id };
}
