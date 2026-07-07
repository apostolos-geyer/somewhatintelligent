import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";
import { requireAdminMiddleware } from "@/lib/middleware/auth";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role?: string | null;
  banned?: boolean | null;
  emailVerified?: boolean | null;
  image?: string | null;
}

export const getUsers = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    const guestlist = getGuestlist();
    const res = await guestlist.auth.admin.listUsers({ query: { limit: 100 } });
    if (res.error) throw new Error(res.error.message ?? "Failed to load users");
    return { users: (res.data?.users ?? []) as AdminUser[] };
  });
