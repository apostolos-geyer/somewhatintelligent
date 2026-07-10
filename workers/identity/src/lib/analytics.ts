/**
 * Analytics — consumer-swappable no-op stub.
 *
 * This app ships with analytics OFF by default: `useCapture()` returns a
 * function that does nothing, and `<AnalyticsProvider>` is a passthrough
 * that just renders its children. The typed event surface (`ClientEvent` /
 * `ClientEventProps`) stays intact so every call site in this app already
 * compiles against the shape a real vendor would want.
 *
 * To wire up a real analytics vendor (PostHog, Segment, etc.):
 *   1. Replace the body of `useCapture` with a hook that calls into your
 *      vendor's SDK, keyed by the same typed `event`/`props` pair.
 *   2. Replace `AnalyticsProvider` with your vendor's provider component
 *      (or wrap it around this one), reading `environment` to decide
 *      whether to initialize (e.g. skip in local dev).
 *   3. Keep the exported names (`useCapture`, `AnalyticsProvider`,
 *      `ClientEvent`, `ClientEventProps`) stable so no call site changes.
 */
import type { ReactNode } from "react";
import type { PlatformSession } from "@somewhatintelligent/auth";

/** Typed client-side event registry. Add new events here as the app grows. */
export interface ClientEventProps {
  signed_up: { method: "email" | "passkey" | "social" };
  signed_in: { method: "email" | "passkey" | "magic_link" | "social" };
  magic_link_requested: Record<string, never>;
  signed_out: Record<string, never>;
  password_changed: Record<string, never>;
  account_deleted: Record<string, never>;
}
export type ClientEvent = keyof ClientEventProps;

/** No-op provider: renders `children` as-is. Swap for a real vendor's provider. */
export function AnalyticsProvider({
  children,
}: {
  app: string;
  environment: string | undefined;
  session: PlatformSession | null;
  children: ReactNode;
}) {
  return children;
}

/** No-op capture hook, typed against {@link ClientEventProps}. */
export function useCapture() {
  return function capture<E extends ClientEvent>(_event: E, _props: ClientEventProps[E]) {
    // no-op — swap in a real vendor call here.
  };
}
