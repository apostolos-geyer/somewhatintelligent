/**
 * `POST /_operator/media/store/products/:productId` — the Access-protected,
 * same-origin store-media ingest endpoint (RFC-0001 D10). A server-only file
 * route (no client bundle), reached by the Objects detail media widget via a
 * plain same-origin `fetch(..., { method: "POST", body: formData })` — no Hono,
 * no second HTTP layer.
 *
 * The file name `[_]operator...` escapes the leading underscore so the URL
 * segment is the literal `_operator`; a bare `_operator` directory would be a
 * TanStack pathless layout and drop from the path. Segments after it are the
 * flat `.`-separated route.
 */
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { handleProductMediaUpload } from "@/lib/media-ingest";
import type { OperatorEnv } from "@/operator-env";

export const Route = createFileRoute("/_operator/media/store/products/$productId")({
  server: {
    handlers: {
      POST: ({ request, params }) =>
        handleProductMediaUpload(request, env as unknown as OperatorEnv, params.productId),
    },
  },
});
