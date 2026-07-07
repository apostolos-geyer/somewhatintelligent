import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { routePartykitRequest } from "partyserver";
import type { SproutEnv } from "../../sprout-env";

// WebSocket upgrade catch-all. Symmetric to `routes/api/$.ts` (the guestlist
// proxy): a TSS file route that hands off to a downstream service binding —
// here, partyserver routes `/ws/<binding-kebab>/<name>` to the matching DO
// instance. partyserver kebab-cases the DO BINDING name (the env key), not the
// class: binding `GROUP_CHAT_ROOM` → `group-chat-room`, so `/ws/group-chat-room/
// <brandId>` resolves to the GroupChatRoom DO, name=<brandId> (`prefix: "ws"`
// strips the leading `ws/` segment). The `prefix: "ws"` here pairs with
// `prefix: "ws"` + `party: "group-chat-room"` on the client's `usePartySocket`.
async function upgrade(request: Request): Promise<Response> {
  return (
    (await routePartykitRequest(request, env as unknown as SproutEnv, { prefix: "ws" })) ??
    new Response("not found", { status: 404 })
  );
}

export const Route = createFileRoute("/ws/$")({
  server: {
    handlers: {
      GET: ({ request }) => upgrade(request),
    },
  },
});
