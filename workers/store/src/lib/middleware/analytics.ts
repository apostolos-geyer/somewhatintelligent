import { makeAnalyticsEvent } from "@si/analytics/server";
import { requireAuthMiddleware } from "./auth";

// APP + deploy env baked once, per worker. requireAuth is folded in, so one
// `.middleware([analyticsEvent(...)])` entry both auth-gates AND instruments.
export const analyticsEvent = makeAnalyticsEvent({
  app: "store",
  requireAuth: requireAuthMiddleware,
  environment: import.meta.env.ENVIRONMENT,
});
