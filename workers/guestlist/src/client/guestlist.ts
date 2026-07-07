import { treaty } from "@elysiajs/eden";
import { createAuthClient } from "better-auth/client";
import type { ClientFetchOption } from "@better-auth/core";
import { parseSetCookie, splitSetCookieString, type CookieSerializeOptions } from "cookie-es";
import type { Actor } from "@greenroom/kit/request-context";
import type { PlatformSession } from "@greenroom/auth";
import type { GuestlistApp } from "../index";
import { guestlistClientPlugins } from "./plugins";

/**
 * Framework-agnostic cookie adapter. Matches the shape popularized by
 * `@supabase/ssr`, `@clerk/nextjs`, and `@auth/core` server helpers:
 * consumer apps provide a `getAll` that reads the incoming request's cookie
 * jar and a `setAll` that writes forwarded cookies onto the outgoing
 * response. Both callbacks may be sync or async so Next 15's `await cookies()`
 * works without wrapping.
 */
export interface GuestlistCookieAdapter {
  /**
   * Called before every guestlist RPC. Returns cookies from the incoming
   * request; the client folds them into a single `Cookie:` header on the
   * outgoing RPC.
   */
  getAll: () =>
    | ReadonlyArray<{ name: string; value: string }>
    | Promise<ReadonlyArray<{ name: string; value: string }>>;
  /**
   * Called after every guestlist RPC. Receives any `Set-Cookie` headers
   * guestlist emitted, parsed into structured form; consumer forwards them
   * onto the outgoing SSR response (e.g. via `setCookie` from
   * `@tanstack/react-start/server`, `cookies().set()` on Next, etc.).
   */
  setAll: (
    cookies: ReadonlyArray<{ name: string; value: string; options?: CookieSerializeOptions }>,
  ) => void | Promise<void>;
}

export interface GuestlistClientOptions {
  /**
   * Guestlist service URL.
   *
   * When calling via a Cloudflare service binding, this host is ignored —
   * any placeholder (e.g. `"http://guestlist.internal"`) works as long as
   * `fetchOptions.customFetchImpl` routes through the binding.
   */
  baseURL: string;

  /**
   * Fetch options passed through to Better Auth's client verbatim and
   * mirrored onto the Eden RPC client.
   *
   * - `customFetchImpl` — swap in a custom fetch (e.g. `env.GUESTLIST.fetch`)
   * - `headers` — static headers applied to every request
   * - `onRequest` / `onResponse` — per-request hooks for custom plumbing
   *
   * Prefer the top-level `cookies` adapter for cookie forwarding instead of
   * hand-rolling `onRequest` — the adapter also captures and forwards
   * response `Set-Cookie` headers, which a manual `onRequest` cannot do.
   *
   * @see https://better-fetch.dev/docs/plugins#hooks
   */
  fetchOptions?: ClientFetchOption;

  /**
   * Cookie adapter. When provided:
   *
   * - Every outgoing guestlist RPC receives a `Cookie:` header built from
   *   `getAll()`.
   * - Every guestlist response's `Set-Cookie` headers are parsed and passed to
   *   `setAll()` so the consumer can forward them onto its own SSR response.
   *
   * Without this adapter, guestlist-emitted cookie refreshes (notably the
   * 5-min `platform.session_data` cache JWT) are silently dropped and the
   * fast-path session reader returns `null` on the next SSR request even
   * when the underlying DB session is valid.
   */
  cookies?: GuestlistCookieAdapter;

  /**
   * Resolves the active request's correlation id. When provided, every
   * outbound call to guestlist carries `cf-request-id: <getRequestId()>`,
   * which guestlist adopts at its fetch boundary (see workers/guestlist/src/
   * index.ts). Threads the same request id across the app→guestlist→promoter
   * span so canonical-log lines correlate one user click to every component
   * it touched.
   */
  getRequestId?: () => string;

  /**
   * Identifies the calling app/service. Forwarded as `x-caller-app`. Guestlist
   * reads this at its fetch boundary into the request-context ALS so every
   * canonical http line emitted during the request is tagged with which app
   * initiated the call (`caller_app: "sprout"` etc.).
   */
  callerApp?: string;

  /**
   * Resolves the active actor for this request. Returns `null` when the
   * caller has no authenticated actor (sign-in/sign-up flows, anonymous
   * page loads). When non-null, guestlist logs receive `x-actor-kind` and
   * `x-actor-id` headers — used for log correlation only.
   *
   * SECURITY: guestlist MUST NEVER use these headers for authorization.
   * They're caller-asserted log hints. Guestlist's authoritative identity
   * still flows through cookies → BA `/get-session` → DB. See
   * workers/guestlist/src/index.ts boundary for the read-but-don't-trust
   * pattern.
   */
  getActor?: () => Actor | null | Promise<Actor | null>;
}

/**
 * Creates the guestlist service client for server-side use.
 *
 * Returns both the full Eden RPC client (`api`) and the full Better Auth
 * client (`auth`) — call either surface directly. A handful of convenience
 * wrappers cover the most common cross-service lookups.
 *
 * ```ts
 * const guestlist = createGuestlistClient({
 *   baseURL: "http://guestlist.internal",
 *   fetchOptions: {
 *     customFetchImpl: env.GUESTLIST.fetch.bind(env.GUESTLIST),
 *   },
 *   cookies: {
 *     getAll: () =>
 *       Object.entries(getCookies()).map(([name, value]) => ({ name, value })),
 *     setAll: (cookies) => {
 *       for (const { name, value, options } of cookies) {
 *         setCookie(name, value, options);
 *       }
 *     },
 *   },
 * });
 *
 * await guestlist.api.admin.stats.get();   // typed Eden RPC
 * await guestlist.auth.signIn.email({ email, password });  // Better Auth
 * await guestlist.getSession();                              // sugar
 * ```
 */
export function createGuestlistClient(options: GuestlistClientOptions) {
  if ("window" in globalThis) {
    throw new Error(
      "createGuestlistClient is server-only. " +
        "Use createGuestlistAuthClient from @greenroom/guestlist-service/client/react instead.",
    );
  }

  const { baseURL, fetchOptions, cookies, getRequestId, callerApp, getActor } = options;

  const baseFetch =
    (fetchOptions?.customFetchImpl as typeof fetch | undefined) ??
    (globalThis.fetch as typeof fetch);
  // Compose pre-call interceptors: cookie adapter folds in `Cookie:` and
  // captures `Set-Cookie`; correlation forwards `cf-request-id`,
  // `x-caller-app`, and (when actor is known) `x-actor-kind` /
  // `x-actor-id` so guestlist's canonical http lines carry full
  // correlation context.
  const cookieWrapped = cookies ? wrapFetchWithCookieAdapter(baseFetch, cookies) : baseFetch;
  const wrappedFetch =
    getRequestId || callerApp || getActor
      ? wrapFetchWithCorrelation(cookieWrapped, { getRequestId, callerApp, getActor })
      : cookieWrapped;

  const auth = createAuthClient({
    baseURL,
    fetchOptions: { ...fetchOptions, customFetchImpl: wrappedFetch },
    plugins: guestlistClientPlugins(),
  });

  const api = treaty<GuestlistApp>(baseURL, {
    fetcher: wrappedFetch,
    headers: fetchOptions?.headers,
    onRequest: bridgeOnRequestToEden(fetchOptions?.onRequest),
  });

  return {
    /** Full Eden Treaty RPC client — typed from `GuestlistApp`. */
    api,

    /** Full Better Auth client with guestlist's plugin set. */
    auth,

    async getSession(): Promise<PlatformSession | null> {
      const res = await auth.getSession();
      return res.data ?? null;
    },

    /**
     * Search the user directory by name OR email substring. A general
     * authenticated-session user lookup primitive (e.g. for mention/picker
     * UIs).
     *
     * - Empty `query` returns `[]` (not all users — that'd be a data leak).
     * - `limit` defaults to 20, max 50.
     * - `email` is returned on every hit (v1 trust model — identity already
     *   exposes email to org admins; tighten later if a less-trusted caller
     *   appears).
     */
    async searchUsers(input: {
      query: string;
      limit?: number;
    }): Promise<Array<{ id: string; name: string; email?: string; image?: string }>> {
      const res = await api.api.users.search.post({
        query: input.query,
        ...(input.limit !== undefined && { limit: input.limit }),
      });
      if (res.error) throw new Error(`searchUsers failed: ${res.error.status}`);
      return res.data?.users ?? [];
    },

    /**
     * Batch-resolve user records by id. A general authenticated-session
     * lookup primitive (e.g. for member-list or author display-name
     * resolution).
     *
     * - Max 100 ids per call.
     * - Return order matches input order.
     * - Missing ids are omitted (not nulled).
     */
    async getUsersByIds(input: {
      ids: string[];
    }): Promise<Array<{ id: string; name: string; email?: string; image?: string }>> {
      const res = await api.api.users["by-ids"].post({ ids: input.ids });
      if (res.error) throw new Error(`getUsersByIds failed: ${res.error.status}`);
      return res.data?.users ?? [];
    },
  };
}

export type GuestlistClient = ReturnType<typeof createGuestlistClient>;

/**
 * Wraps a fetch impl to inject correlation headers on every outgoing
 * request — adopted by guestlist at its fetch boundary so the same context
 * threads through every canonical-log line emitted on either side:
 *
 *   - `cf-request-id` — request id (for log correlation across services)
 *   - `x-caller-app`  — which app/service initiated the call
 *   - `x-actor-kind` / `x-actor-id` — caller-asserted actor identity
 *     (LOG CORRELATION ONLY; guestlist never trusts for authz)
 *
 * Caller-set values on `init.headers` win, so explicit overrides still work.
 * Actor headers are omitted when `getActor()` returns null (auth flows,
 * anonymous page loads).
 */
function wrapFetchWithCorrelation(
  realFetch: typeof fetch,
  opts: {
    getRequestId?: () => string;
    callerApp?: string;
    getActor?: () => Actor | null | Promise<Actor | null>;
  },
): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? undefined);
    if (opts.getRequestId && !headers.has("cf-request-id")) {
      headers.set("cf-request-id", opts.getRequestId());
    }
    if (opts.callerApp && !headers.has("x-caller-app")) {
      headers.set("x-caller-app", opts.callerApp);
    }
    if (opts.getActor && !headers.has("x-actor-kind")) {
      const actor = await opts.getActor();
      if (actor) {
        headers.set("x-actor-kind", actor.kind);
        headers.set("x-actor-id", actor.kind === "user" ? actor.userId : actor.serviceName);
      }
    }
    return realFetch(input, { ...init, headers });
  };
  return wrapped as unknown as typeof fetch;
}

/**
 * Wraps a fetch impl with two responsibilities:
 *   1. Before the call: fold `cookies.getAll()` into the outgoing `Cookie:` header.
 *   2. After the call: parse every `Set-Cookie` on the response, push to `cookies.setAll()`.
 *
 * Wrapping at the fetch level (rather than better-fetch's `onRequest`/`onResponse`)
 * means both the Better Auth client and the Eden Treaty client get the
 * behavior with a single hook — treaty has no `onResponse` equivalent, so
 * a higher-level approach wouldn't cover its responses.
 */
function wrapFetchWithCookieAdapter(
  realFetch: typeof fetch,
  cookies: GuestlistCookieAdapter,
): typeof fetch {
  const wrapped = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const headers = new Headers(init?.headers ?? undefined);
    const incoming = await cookies.getAll();
    if (incoming.length > 0) {
      const folded = incoming.map((c) => `${c.name}=${c.value}`).join("; ");
      const existing = headers.get("cookie");
      headers.set("cookie", existing ? `${existing}; ${folded}` : folded);
    }

    const response = await realFetch(input, { ...init, headers });

    const rawSetCookies = readSetCookies(response.headers);
    if (rawSetCookies.length > 0) {
      const parsed: Array<{ name: string; value: string; options?: CookieSerializeOptions }> = [];
      for (const raw of rawSetCookies) {
        const sc = parseSetCookie(raw);
        if (!sc) continue;
        const { name, value, ...rest } = sc;
        parsed.push({ name, value, options: rest as CookieSerializeOptions });
      }
      if (parsed.length > 0) await cookies.setAll(parsed);
    }

    return response;
  };
  return wrapped as unknown as typeof fetch;
}

/**
 * Reads `Set-Cookie` values off a Headers instance, handling:
 *  - Runtimes that implement `Headers.getSetCookie()` (modern Node, CF Workers).
 *  - Legacy runtimes where `headers.get("set-cookie")` returns a comma-folded
 *    string — split correctly via `splitSetCookieString`, which doesn't choke
 *    on commas inside `Expires=` attribute values.
 */
function readSetCookies(headers: Headers): string[] {
  const maybeGetSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof maybeGetSetCookie === "function") {
    return maybeGetSetCookie.call(headers);
  }
  const raw = headers.get("set-cookie");
  return raw ? splitSetCookieString(raw) : [];
}

/**
 * Adapts a Better-Fetch `onRequest` hook (context object) to Eden's
 * `onRequest` hook (path + RequestInit). Keeps header/body/method edits
 * made inside the hook.
 */
function bridgeOnRequestToEden(
  hook: ClientFetchOption["onRequest"] | undefined,
): ((path: string, init: RequestInit) => Promise<RequestInit | void>) | undefined {
  if (!hook) return undefined;
  return async (path, init) => {
    const headers =
      init.headers instanceof Headers ? init.headers : new Headers(init.headers as HeadersInit);
    const ctx = {
      url: path,
      headers,
      method: init.method ?? "GET",
      body: init.body,
      signal: init.signal ?? undefined,
    };
    const result = await hook(ctx as never);
    const next = (result ?? ctx) as typeof ctx;
    return {
      ...init,
      headers: next.headers,
      method: next.method,
      body: next.body as RequestInit["body"],
    };
  };
}
