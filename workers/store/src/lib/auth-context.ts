import { createAuthContext } from "@somewhatintelligent/kit/react";
import { createReactStartAuthProvider } from "@somewhatintelligent/kit/react-start/client";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { loadSession } from "@/lib/session.functions";

const authContext = createAuthContext<PlatformSession>();

export const { useAuth } = authContext;
export const AuthProvider = createReactStartAuthProvider({
  authContext,
  loadSession,
});
