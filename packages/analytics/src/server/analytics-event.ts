// packages/analytics/src/server/analytics-event.ts   —  INTERNAL; re-exported by index.ts
import { createMiddleware } from "@tanstack/react-start";
import type { AnyFunctionMiddleware } from "@tanstack/react-start"; // verified export (1.168.18)
import type { PlatformSession } from "@si/auth";
import type { AppName, ServerEvent, ServerEventProps } from "../events";

export type Derived<E extends ServerEvent> = {
  properties: ServerEventProps[E];
  group?: boolean;
} | null;

/**
 * Bind an app + its session-producing auth middleware ONCE, per worker. Returns
 * the declarative `analyticsEvent(event, derive?)` used inside `.middleware([…])`.
 * Fires ONLY when the handler resolves; `distinctId` is derived from
 * `context.session.user.id` and can never be supplied by a call site.
 */
export function makeAnalyticsEvent(config: {
  app: AppName;
  requireAuth: AnyFunctionMiddleware;
  environment: string | undefined;
}) {
  return function analyticsEvent<E extends ServerEvent>(
    event: E,
    // Optional: a property-less business event drops on bare — `analyticsEvent("some_event")`.
    derive?: (args: { session: PlatformSession; data: unknown; result: unknown }) => Derived<E>,
  ) {
    return createMiddleware({ type: "function" })
      .middleware([config.requireAuth]) // session guaranteed non-null; anon → 401 before the handler
      .server(async ({ context, data, next }) => {
        const res = await next(); // throws on handler failure/redirect → nothing below runs → nothing emitted
        const session = context.session as PlatformSession; // single cast, sealed in the package
        // next()'s runtime object carries `.result` (the handler return); the public type hides it.
        const derived = derive
          ? derive({ session, data, result: (res as unknown as { result: unknown }).result })
          : ({ properties: {} as ServerEventProps[E] } as Derived<E>);
        if (derived) {
          const { deliverIdentified } = await import("./delivery");
          const orgId = session.session.activeOrganizationId;
          await deliverIdentified(
            config.app,
            session.user.id, // the engineer literally cannot provide or mistype this
            event,
            derived.properties,
            config.environment,
            derived.group && orgId ? { organization: orgId } : undefined,
          );
        }
        return res; // a middleware MUST return next()'s result
      });
  };
}
