import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";
import { requireAdminMiddleware } from "@/lib/middleware/auth";

export interface AdminStats {
  users: number;
  sessions: number;
  clients: number;
}

export const getStats = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async (): Promise<AdminStats> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.stats.get();
    return res.data ?? { users: 0, sessions: 0, clients: 0 };
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
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin["api-keys"].get();
    return { apiKeys: (res.data?.apiKeys ?? []) as AdminApiKey[] };
  });
