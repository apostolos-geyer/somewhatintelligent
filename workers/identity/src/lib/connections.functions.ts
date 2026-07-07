import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";
import { requireUserMiddleware } from "@/lib/middleware/auth";
import { toStringArray } from "@/lib/normalize";

export interface Connection {
  consentId: string;
  clientId: string;
  scopes: string[];
  createdAt: string | null;
  clientName: string | null;
  clientIcon: string | null;
}

export const fetchConnections = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async () => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.user.connections.get();
    const connections: Connection[] = (res.data?.connections ?? []).map((c) => ({
      consentId: c.consentId,
      clientId: c.clientId,
      scopes: toStringArray(c.scopes, " "),
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      clientName: c.clientName,
      clientIcon: c.clientIcon,
    }));
    return { connections };
  });
