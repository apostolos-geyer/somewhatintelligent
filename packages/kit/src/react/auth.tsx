/**
 * Framework-independent auth context.
 *
 * `createAuthContext<S>()` returns a `{ Context, useAuth, BaseAuthProvider }`
 * triple. `BaseAuthProvider` is a thin wrapper around `Context.Provider` —
 * it does NOT manage state, fetch sessions, or know about any data-fetching
 * framework. State + refetch is layered on top by framework-specific
 * providers (see `kit/react-start`'s `createReactStartAuthProvider` for the
 * TanStack Start binding; future Expo / Storybook bindings would re-implement
 * the provider with their own data idiom but reuse the same `useAuth()`
 * consumer interface).
 *
 * Apps glue it together once per app:
 *
 *   const authContext = createAuthContext<PlatformSession>();
 *   export const { useAuth } = authContext;
 *   export const AuthProvider = createReactStartAuthProvider({
 *     authContext,
 *     loadSession,
 *   });
 */
import { createContext, useContext, type ReactNode } from "react";

export interface AuthContextValue<S> {
  /** Current session value. `null` when unauthenticated. */
  session: S | null;
  /** Convenience: `session?.user ?? null`. */
  user: S extends { user: infer U } ? U | null : null;
  /** `session != null`. */
  isAuthenticated: boolean;
  /** `true` while a refetch is in-flight. */
  isLoading: boolean;
  /** Re-runs the loader; updates `session`/`isLoading` state. */
  refetch: () => Promise<void>;
  /** Strict equality match against `session.user.role`. */
  hasRole: (role: string) => boolean;
  /** Returns `true` if the user's role is in `roles`. */
  hasAnyRole: (roles: ReadonlyArray<string>) => boolean;
}

export function createAuthContext<S extends { user: { role?: string | null } }>() {
  const Ctx = createContext<AuthContextValue<S> | null>(null);

  function useAuth(): AuthContextValue<S> {
    const value = useContext(Ctx);
    if (!value) {
      throw new Error("useAuth() must be called inside an AuthProvider");
    }
    return value;
  }

  function BaseAuthProvider({
    value,
    children,
  }: {
    value: AuthContextValue<S>;
    children: ReactNode;
  }) {
    return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
  }

  return { Context: Ctx, useAuth, BaseAuthProvider };
}
