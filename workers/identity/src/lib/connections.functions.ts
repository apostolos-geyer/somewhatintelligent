import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { requestCookie } from "@/lib/request-cookie";
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

interface RawConnectionRow {
  consentId: string;
  clientId: string;
  scopes: unknown;
  createdAt: string | number | Date | null;
  clientName: string | null;
  clientIcon: string | null;
}

export const fetchConnections = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async () => {
    // The RPC's success arm (drizzle rows) isn't `Rpc.Serializable`, so the
    // stub type drops it and leaves only the `RpcErr` arms; re-assert the
    // success shape so the guard narrows to it.
    const res = (await env.GUESTLIST.getConnections({ cookie: requestCookie() })) as
      | { ok: true; connections: RawConnectionRow[] }
      | { ok: false; error: string };
    if (!res.ok) throw new Error(res.error);
    const connections: Connection[] = res.connections.map((c) => ({
      consentId: c.consentId,
      clientId: c.clientId,
      scopes: toStringArray(c.scopes, " "),
      createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null,
      clientName: c.clientName,
      clientIcon: c.clientIcon,
    }));
    return { connections };
  });
