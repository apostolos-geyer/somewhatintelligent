import { env } from "cloudflare:workers";
import { createRoadieClient, type RoadieActor } from "@si/roadie-service/client";
import { getRequestContext } from "@somewhatintelligent/kit/request-context";
import { ulid } from "@somewhatintelligent/kit/ids";

// Roadie (R2 blob) client factory for the store — product photos. Wraps
// `env.ROADIE` so callers do `getRoadie().registerUpload(...)` / `.finalize(...)`
// / `.getReadUrl(...)` / `.removeReference(...)` without hand-rolling `meta`
// (callerApp/actor/requestId) per call. Mirrors workers/sprout/src/lib/roadie.ts,
// minus TSS's ambient `getRequest()` — store has no TSS request context (RPC
// entrypoints and the Hono API alike), so requestId/actor are best-effort log
// correlation: kit's own request-context ALS when a scope is open, else fresh.
export function getRoadie() {
  return createRoadieClient(env.ROADIE, {
    callerApp: "store",
    getRequestId: () => getRequestContext()?.requestId ?? ulid(),
    getActor: (): RoadieActor => {
      const ctx = getRequestContext();
      return ctx?.actorKind === "user" && ctx.actorId
        ? { kind: "user", userId: ctx.actorId }
        : { kind: "anonymous", label: "unauthenticated" };
    },
  });
}
