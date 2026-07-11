/**
 * Analytics adapter — bridges the app's typed capture surface onto
 * @si/analytics (PostHog). The provider pins app="identity" so events are
 * stamped correctly regardless of what the shell passes down; capture is
 * @si/analytics's typed hook (this app's event registry is a subset of the
 * fleet-wide one in @si/analytics/events, so the assignment is checked).
 */
import {
  AnalyticsProvider as SiAnalyticsProvider,
  useCapture as useSiCapture,
} from "@si/analytics/client";
import type { AnalyticsAdapter, CaptureFn } from "@somewhatintelligent/kit/react";
import type { PlatformSession } from "@somewhatintelligent/auth";
import type { ClientEventProps } from "./lib/analytics-events";

export type IdentityAnalyticsAdapter = AnalyticsAdapter<ClientEventProps, PlatformSession>;

const adapter: IdentityAnalyticsAdapter = {
  Provider: ({ environment, session, children }) => (
    <SiAnalyticsProvider app="identity" environment={environment} session={session}>
      {children}
    </SiAnalyticsProvider>
  ),
  useCapture: () => {
    // This app's registry is a name/shape subset of @si/analytics's fleet-wide
    // map, but TS can't prove generic-fn assignability across the two — the
    // cast is safe because every identity event key/shape exists verbatim in
    // @si/analytics/events.
    const capture = useSiCapture();
    return capture as unknown as CaptureFn<ClientEventProps>;
  },
};

export default adapter;
