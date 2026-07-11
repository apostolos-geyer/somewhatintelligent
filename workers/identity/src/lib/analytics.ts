/**
 * App-facing analytics surface, assembled from the kit seam + the
 * consumer-edited adapter (`src/analytics.adapter.ts`). Call sites import
 * `useCapture` / `useCaptureAsync` / `AnalyticsProvider` from here and never
 * change when the vendor does. With no adapter, everything is a typed no-op.
 */
import { createAnalytics } from "@somewhatintelligent/kit/react";
import type { PlatformSession } from "@somewhatintelligent/auth";
import adapter from "../analytics.adapter";
import type { ClientEventProps } from "./analytics-events";

export type { ClientEvent, ClientEventProps } from "./analytics-events";
export type { IdentityAnalyticsAdapter } from "../analytics.adapter";

export const { AnalyticsProvider, useCapture, useCaptureAsync } = createAnalytics<
  ClientEventProps,
  PlatformSession
>(adapter);
