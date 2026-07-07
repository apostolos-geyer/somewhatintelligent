import { createAuthContext } from "@greenroom/kit/react";
import { createReactStartAuthProvider } from "@greenroom/kit/react-start/client";
import type { PlatformSession } from "@greenroom/auth";
import { loadSession } from "@/lib/session.functions";

const authContext = createAuthContext<PlatformSession>();

export const { useAuth } = authContext;
export const AuthProvider = createReactStartAuthProvider({
  authContext,
  loadSession,
});
