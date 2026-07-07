import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";
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
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.sessions.get();
    return { sessions: (res.data?.sessions ?? []) as AdminSession[] };
  });
