/**
 * Roadie (R2 blob) client factory for sprout. Wraps `env.ROADIE` so callers do
 * `getRoadie().registerUpload(...)` / `.finalize(...)` / `.getReadUrl(...)` /
 * `.put(...)` without hand-rolling `meta` (callerApp/actor/requestId) per call.
 * Mirrors `lib/guestlist.ts`. All blobs are minted under `caller_app:"sprout"`
 * (greenfield no-op for the quiz/chat fold-in — 09 §7).
 *
 * Roadie blob I/O needs R2/S3 secrets (09 §8), so these calls are inert in local
 * dev until provisioned; the surrounding D1 metadata paths run locally.
 */
import { env } from "cloudflare:workers";
import { createRoadieClient } from "@greenroom/roadie-service/client";
import { createRoadieFactory } from "@greenroom/kit/react-start";

export const getRoadie = createRoadieFactory({
  callerApp: "sprout",
  createClient: createRoadieClient as Parameters<
    typeof createRoadieFactory<ReturnType<typeof createRoadieClient>, typeof env.ROADIE>
  >[0]["createClient"],
  getBinding: () => env.ROADIE,
});
