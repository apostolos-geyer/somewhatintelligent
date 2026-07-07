// packages/analytics/src/server/index.ts   →  @si/analytics/server   (the ONLY public server surface)
import type { AppName, ServerEvent, ServerEventProps } from "../events";
export { makeAnalyticsEvent, type Derived } from "./analytics-event";

// Deliberately NO distinctId-taking capture is exported. Person-scoped delivery
// is reachable only through the middleware `makeAnalyticsEvent` returns, which forces
// distinctId = session.user.id. A "server event on the wrong person" is not
// representable at any call site.
export function serverAnalytics(app: AppName, environment: string | undefined) {
  return {
    /** The rare genuinely-anonymous server metric. NOT for user events. */
    async captureAnonymous<E extends ServerEvent>(
      event: E,
      properties: ServerEventProps[E],
    ): Promise<void> {
      const { deliverAnonymous } = await import("./delivery");
      return deliverAnonymous(app, event, properties, environment);
    },
  };
}
