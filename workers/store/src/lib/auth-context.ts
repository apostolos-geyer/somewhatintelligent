import { createAuthContext } from "@si/kit/react";
import { createReactStartAuthProvider } from "@si/kit/react-start/client";
import type { PlatformSession } from "@si/auth";
import { loadSession } from "@/lib/session.functions";

const authContext = createAuthContext<PlatformSession>();

export const { useAuth } = authContext;
export const AuthProvider = createReactStartAuthProvider({
  authContext,
  loadSession,
});
