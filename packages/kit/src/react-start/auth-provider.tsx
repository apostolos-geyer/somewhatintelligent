/**
 * TanStack Start-aware auth provider factory.
 *
 * Glue between kit/react's framework-independent `createAuthContext` and
 * TSS's `useServerFn`. Apps mount the returned `<AuthProvider>` once in
 * `__root.tsx`, seeding `initialSession` from the SSR'd
 * `Route.useRouteContext().session` so first paint requires zero round-trip.
 *
 * `refetch` calls the supplied `loadSession` server-fn through `useServerFn`
 * so loading state and TSS's request-cancel/dedup affordances flow through.
 *
 * @example
 *   // app/src/lib/auth-context.ts
 *   import { createAuthContext } from "@greenroom/kit/react";
 *   import { createReactStartAuthProvider } from "@greenroom/kit/react-start/client";
 *   import { loadSession } from "@/lib/session.server";
 *
 *   const authContext = createAuthContext<PlatformSession>();
 *   export const { useAuth } = authContext;
 *   export const AuthProvider = createReactStartAuthProvider({ authContext, loadSession });
 */
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { AuthContextValue, createAuthContext } from "../react/auth";

export interface ReactStartAuthProviderOpts<S extends { user: { role?: string | null } }> {
  /** Output of `createAuthContext<S>()` from `@greenroom/kit/react`. */
  authContext: ReturnType<typeof createAuthContext<S>>;
  /**
   * The `createServerFn` returned by `createSessionFactory` (or any
   * equivalent server-fn that resolves the current session). Wired through
   * `useServerFn` so refetch loading state lives in React.
   */
  loadSession: () => Promise<S | null>;
}

export function createReactStartAuthProvider<S extends { user: { role?: string | null } }>(
  opts: ReactStartAuthProviderOpts<S>,
) {
  const { authContext, loadSession } = opts;
  const { BaseAuthProvider } = authContext;

  return function AuthProvider({
    initialSession,
    children,
  }: {
    initialSession: S | null;
    children: ReactNode;
  }) {
    const fn = useServerFn(loadSession);
    const [session, setSession] = useState<S | null>(initialSession);
    const [isLoading, setIsLoading] = useState(false);

    const refetch = useCallback(async () => {
      setIsLoading(true);
      try {
        const next = await fn();
        setSession(next);
      } finally {
        setIsLoading(false);
      }
    }, [fn]);

    const value = useMemo<AuthContextValue<S>>(
      () =>
        ({
          session,
          user: session?.user ?? null,
          isAuthenticated: session != null,
          isLoading,
          refetch,
          hasRole: (role: string) => session?.user?.role === role,
          hasAnyRole: (roles: ReadonlyArray<string>) =>
            session ? roles.includes(session.user?.role ?? "") : false,
        }) as AuthContextValue<S>,
      [session, isLoading, refetch],
    );

    return <BaseAuthProvider value={value}>{children}</BaseAuthProvider>;
  };
}
