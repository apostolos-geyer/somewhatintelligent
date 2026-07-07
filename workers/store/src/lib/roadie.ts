import { env } from "cloudflare:workers";
import { createRoadieClient } from "@si/roadie-service/client";
import { createRoadieFactory } from "@si/kit/react-start";

// Roadie (R2 blob) client factory for the store — product photos. Wraps
// `env.ROADIE` so callers do `getRoadie().registerUpload(...)` / `.finalize(...)`
// / `.getReadUrl(...)` / `.removeReference(...)` without hand-rolling `meta`
// (callerApp/actor/requestId) per call. Mirrors workers/sprout/src/lib/roadie.ts.
// The ROADIE binding MUST carry `entrypoint: "Roadie"` + `props.callerApp:
// "store"` (wrangler.jsonc) or readCallerApp throws on every call.
export const getRoadie = createRoadieFactory({
  callerApp: "store",
  createClient: createRoadieClient as Parameters<
    typeof createRoadieFactory<ReturnType<typeof createRoadieClient>, typeof env.ROADIE>
  >[0]["createClient"],
  getBinding: () => env.ROADIE,
});
