/**
 * `POST /_operator/media/publisher/:ownerType/:ownerId` — the Access-protected,
 * same-origin Publisher-media ingest endpoint (RFC-0001 D10 / T19). The twin of
 * the Store product-media route: a server-only file route (no client bundle),
 * reached by the text/software/page editors' media widgets via a plain
 * same-origin `fetch(..., { method: "POST", body: formData })`.
 *
 * `:ownerType` is `text | software | page`; `:ownerId` is the record id (a
 * PageKey for pages). See `[_]operator...` naming note on the store route for why
 * the leading underscore is escaped.
 */
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { handlePublisherMediaUpload } from "@/lib/media-ingest";
import type { OperatorEnv } from "@/operator-env";

export const Route = createFileRoute("/_operator/media/publisher/$ownerType/$ownerId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handlePublisherMediaUpload(
          request,
          env as unknown as OperatorEnv,
          params.ownerType,
          params.ownerId,
        ),
    },
  },
});
