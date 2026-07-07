// Public product-image endpoint. Resolves a Roadie reference id to a signed R2
// URL and 302s to it. The signed URL is re-minted per request (Roadie caches
// it in D1). Never logs the signed URL. Caller-scoped: only references owned by
// the `storefront` caller resolve.
import { createFileRoute } from "@tanstack/react-router";
import { getRoadie } from "@/lib/roadie";
import { IMAGE_URL_LIFETIME_SECONDS } from "@/lib/config";

export const Route = createFileRoute("/api/img/$refId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const refId = params.refId;
        try {
          const result = await getRoadie().getReadUrl({
            referenceId: refId,
            lifetimeSeconds: IMAGE_URL_LIFETIME_SECONDS,
            disposition: "inline",
            permissionScope: "public",
          });
          if (!result.ok) return new Response("Not Found", { status: 404 });
          return new Response(null, {
            status: 302,
            headers: {
              Location: result.value.url,
              // Allow the browser to cache the redirect briefly; the signed
              // URL itself outlives this.
              "Cache-Control": "private, max-age=300",
            },
          });
        } catch {
          return new Response("Not Found", { status: 404 });
        }
      },
    },
  },
});
