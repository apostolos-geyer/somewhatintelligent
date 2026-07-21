/**
 * Roadie (R2 blob) client factory for Publisher — text/page/software media.
 * Mirrors workers/store/src/lib/roadie.ts, but Publisher is a plain RPC
 * worker with no TanStack Start request context, so the client is built
 * directly from `createRoadieClient` with a service actor: Operator identity
 * lives in Publisher's own operator_event rows, and every Roadie call is
 * Publisher-the-service acting on its own references.
 *
 * The ROADIE binding MUST carry `entrypoint: "Roadie"` + `props.callerApp:
 * "publisher"` (wrangler.jsonc) or readCallerApp throws on every call.
 */
import { createRoadieClient, type RoadieClient } from "@si/roadie-service/client";

import type { PublisherEnv } from "../publisher-env";

export function getRoadie(env: PublisherEnv): RoadieClient {
  return createRoadieClient(env.ROADIE, {
    callerApp: "publisher",
    getRequestId: () => crypto.randomUUID(),
    getActor: () => ({ kind: "service", serviceName: "publisher" }),
  });
}
