// packages/analytics/src/server/delivery.ts   —  INTERNAL to @si/analytics (NOT in "exports")
// The only place in the platform that supplies a PostHog distinctId.
import { PostHog } from "posthog-node";
import { executionContext } from "@somewhatintelligent/kit/execution-context";
import { platformAnalyticsConfig } from "@si/config";
import { ulid } from "@somewhatintelligent/kit/ids";
import type { AppName, ServerEvent, ServerEventProps } from "../events";

let client: PostHog | null = null;
const analytics = () =>
  (client ??= new PostHog(platformAnalyticsConfig.token, {
    host: platformAnalyticsConfig.host,
    flushAt: 1,
    flushInterval: 0, // no background timer; captureImmediate sends inline
  }));

// waitUntil when a ctx is seeded (zero added latency), else await (never dropped).
async function send(payload: Parameters<PostHog["captureImmediate"]>[0]): Promise<void> {
  const sent = analytics().captureImmediate(payload);
  const ctx = executionContext.getStore();
  if (ctx) {
    ctx.waitUntil(sent);
    return;
  }
  await sent;
}

/** Person-scoped. `distinctId` is REQUIRED and — by construction of its only
 *  caller, `analyticsEvent` — is always `session.user.id`. */
export function deliverIdentified<E extends ServerEvent>(
  app: AppName,
  distinctId: string,
  event: E,
  properties: ServerEventProps[E],
  environment: string | undefined,
  groups?: { organization: string },
): Promise<void> {
  return send({
    distinctId,
    event,
    properties: { ...properties, app, environment },
    groups,
  });
}

/** Anonymous-scoped. `$process_person_profile:false` + a throwaway id, so it can
 *  never create or mutate a person. */
export function deliverAnonymous<E extends ServerEvent>(
  app: AppName,
  event: E,
  properties: ServerEventProps[E],
  environment: string | undefined,
): Promise<void> {
  return send({
    distinctId: ulid(),
    event,
    properties: {
      ...properties,
      app,
      environment,
      $process_person_profile: false,
    },
  });
}
