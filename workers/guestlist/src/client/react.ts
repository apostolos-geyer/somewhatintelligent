"use client";

import { treaty } from "@elysiajs/eden";
import { createAuthClient } from "better-auth/react";
import type { ClientFetchOption } from "@better-auth/core";
import type { GuestlistApp } from "../index";
import { guestlistClientPlugins } from "./plugins";
import { createAvatarMethods } from "./avatar";

export interface GuestlistAuthClientOptions {
  /**
   * App-root URL of the guestlist service — e.g. `https://guestlist.platform.example`
   * to talk to guestlist directly cross-origin, or `${window.location.origin}`
   * when the consumer app proxies `/api/*` to guestlist over a service binding.
   *
   * Better Auth's handler is mounted at `/api/auth` and guestlist's typed RPC
   * routes (`/users/lookup`, `/api/avatar/*`, etc.) sit at the root; the
   * client derives both endpoint URLs from this single root, so callers
   * only ever pass one URL.
   */
  baseURL: string;

  /**
   * Fetch options passed through to Better Auth's client and mirrored onto
   * the eden RPC client. Browser-side, cookies attach automatically when
   * `credentials: "include"` is set on the underlying fetch.
   */
  fetchOptions?: ClientFetchOption;
}

/**
 * Creates the guestlist client for browser-side React use.
 *
 * Returns three coordinated surfaces on a single object:
 *  - `auth` — the typed Better Auth React client (`useSession`, `signIn`,
 *    `signOut`, `updateUser`, etc.)
 *  - `api`  — the typed eden treaty client against `GuestlistApp`, for
 *    direct typed access to guestlist routes
 *  - `setAvatar` / `removeAvatar` — composed methods built on top of the
 *    treaty client; canonical entry points for avatar swap/clear so callers
 *    get `useMutation({ mutationFn: () => guestlist.setAvatar(blob, opts) })`
 *    ergonomics without re-implementing the register/upload/confirm dance.
 *
 * ```ts
 * export const guestlist = createGuestlistAuthClient({
 *   baseURL: window.location.origin, // proxied via /api/*
 * });
 *
 * function Header() {
 *   const { data: session } = guestlist.auth.useSession();
 *   const { mutate } = useMutation({
 *     mutationFn: ({ blob }: { blob: Blob }) =>
 *       guestlist.setAvatar(blob, { contentType: "image/jpeg" }),
 *   });
 *   // ...
 * }
 * ```
 */
export function createGuestlistAuthClient(options: GuestlistAuthClientOptions) {
  const { baseURL, fetchOptions } = options;

  const auth = createAuthClient({
    // BA's handler lives at /api/auth on guestlist; the client's `baseURL`
    // is BA's endpoint root, not the app root.
    baseURL: `${baseURL}/api/auth`,
    fetchOptions,
    plugins: guestlistClientPlugins(),
  });

  // Treaty operates against the app root so route paths in `GuestlistApp`
  // (`/users/lookup`, `/api/avatar/register`, etc.) resolve correctly.
  const api = treaty<GuestlistApp>(baseURL, {
    fetcher: fetchOptions?.customFetchImpl as typeof fetch | undefined,
    headers: fetchOptions?.headers,
    fetch: { credentials: "include" },
  });

  return {
    api,
    auth,
    ...createAvatarMethods(api),
  };
}

export type GuestlistAuthClient = ReturnType<typeof createGuestlistAuthClient>;
