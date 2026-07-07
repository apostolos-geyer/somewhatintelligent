import { env, SELF } from "cloudflare:test";
import { platformConfig, platformDeployConfig } from "@greenroom/config";

/**
 * Dev origin used as the `Origin` header on auth requests in tests, derived
 * from config so a rebrand keeps it in sync. Preserves the http:// scheme the
 * tests have always used for the guestlist subdomain.
 */
export const GUESTLIST_DEV_ORIGIN = `http://guestlist.${platformDeployConfig.devDomain}`;

/** Config-derived base domain for example/test emails (e.g. `user@test.<baseDomain>`). */
export const TEST_EMAIL_DOMAIN = `test.${platformDeployConfig.baseDomain}`;

/** Config-derived cookie prefix; wire names are `${prefix}.session_token` / `${prefix}.session_data`. */
export const COOKIE_PREFIX = platformConfig.cookies.prefix;

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
    headers: {
      "Content-Type": "application/json",
      Origin: GUESTLIST_DEV_ORIGIN,
    },
    body: JSON.stringify({
      name: opts.name,
      email: opts.email,
      password: opts.password,
    }),
  });

  const signUpBody = (await signUpRes.json()) as Record<string, unknown>;
  const userId =
    (signUpBody.user as Record<string, unknown>)?.id ?? (signUpBody as Record<string, unknown>).id;
  if (!userId) {
    throw new Error(`Sign-up failed for ${opts.email}: ${JSON.stringify(signUpBody)}`);
  }

  // Auto-verify email directly in D1
  await env.DB.prepare("UPDATE user SET email_verified = 1 WHERE id = ?")
    .bind(userId as string)
    .run();

  // Sign in to get valid session cookies
  const signInRes = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: GUESTLIST_DEV_ORIGIN,
    },
    body: JSON.stringify({
      email: opts.email,
      password: opts.password,
    }),
  });

  const cookies = extractCookies(signInRes);
  return { cookies, userId: userId as string };
}

/**
 * Extract Set-Cookie values joined into a single Cookie header string.
 */
export function extractCookies(res: Response): string {
  const setCookies = res.headers.getAll
    ? res.headers.getAll("Set-Cookie")
    : (res.headers.get("Set-Cookie")?.split(/,(?=\s*\w+=)/) ?? []);
  return setCookies
    .map((c) => c.split(";")[0]!.trim())
    .filter(Boolean)
    .join("; ");
}

/**
 * Extract raw Set-Cookie header strings (for domain/attribute parsing).
 */
export function getRawSetCookies(res: Response): string[] {
  if (res.headers.getAll) {
    return res.headers.getAll("Set-Cookie");
  }
  return res.headers.get("Set-Cookie")?.split(/,(?=\s*\w+=)/) ?? [];
}

let counter = 0;

/**
 * Generate a unique test email to avoid collisions between tests.
 */
export function uniqueEmail(prefix = "test"): string {
  counter += 1;
  return `${prefix}-${counter}-${Date.now()}@${TEST_EMAIL_DOMAIN}`;
}

/**
 * Sign up a verified user and promote them to admin via D1.
 * Returns session cookies and userId.
 */
export async function signUpAdmin(opts: {
  name: string;
  email: string;
  password: string;
}): Promise<{ cookies: string; userId: string }> {
  const result = await signUpVerified(opts);
  await env.DB.prepare("UPDATE user SET role = 'admin' WHERE id = ?").bind(result.userId).run();
  // Re-sign in so the fresh session reflects the updated role
  const signInRes = await SELF.fetch("http://localhost/api/auth/sign-in/email", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: GUESTLIST_DEV_ORIGIN,
    },
    body: JSON.stringify({ email: opts.email, password: opts.password }),
  });
  const cookies = extractCookies(signInRes);
  return { cookies, userId: result.userId };
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

/**
 * Insert an OAuth consent directly into D1 for test arrangement.
 */
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

/**
 * Insert an OAuth access token directly into D1.
 */
export async function createOAuthAccessToken(opts: {
  clientId: string;
  userId: string;
  scopes: string[];
}): Promise<{ id: string }> {
  counter += 1;
  const id = `at-${counter}-${Date.now()}`;
  const token = `tok-${counter}-${Date.now()}`;
  const now = Date.now();
  const expires = now + 3600_000;
  await env.DB.prepare(
    `INSERT INTO oauth_access_token (id, token, client_id, user_id, expires_at, created_at, scopes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, token, opts.clientId, opts.userId, expires, now, JSON.stringify(opts.scopes))
    .run();
  return { id };
}
