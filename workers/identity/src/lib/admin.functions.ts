import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { requestCookie } from "@/lib/request-cookie";
import { requireAdminMiddleware } from "@/lib/middleware/auth";

export interface AdminStats {
  users: number;
  sessions: number;
  clients: number;
}

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async (): Promise<AdminStats> => {
    const res = await env.GUESTLIST.adminStats({ cookie: requestCookie() });
    if (!res.ok) return { users: 0, sessions: 0, clients: 0 };
    return { users: res.users, sessions: res.sessions, clients: res.clients };
  });

export interface AdminApiKey {
  id: string;
  name: string | null;
  prefix: string | null;
  enabled: boolean;
  createdAt: string | Date | null;
  ownerEmail: string | null;
}

export const getApiKeys = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const res = await env.GUESTLIST.adminListApiKeys({ cookie: requestCookie() });
    if (!res.ok) throw new Error(res.error);
    return { apiKeys: res.apiKeys as AdminApiKey[] };
  });
