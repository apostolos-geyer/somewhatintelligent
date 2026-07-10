import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { requestCookie } from "@/lib/request-cookie";
import { requireAdminMiddleware } from "@/lib/middleware/auth";

export interface AdminSession {
  id: string;
  userId: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string | Date;
  expiresAt: string | Date;
  userName: string | null;
  userEmail: string | null;
  userImage: string | null;
}

export const getSessions = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const res = await env.GUESTLIST.adminListSessions({ cookie: requestCookie() });
    if (!res.ok) throw new Error(res.error);
    return { sessions: res.sessions as AdminSession[] };
  });
