import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";
import { requireAdminMiddleware } from "@/lib/middleware/auth";

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  username?: string | null;
  role?: string | null;
  banned?: boolean | null;
  emailVerified?: boolean | null;
  image?: string | null;
}

export const USERS_PAGE_SIZE = 50;

export const getUsers = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { q?: string; page?: number }) => data)
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const q = data.q?.trim();
    const page = Math.max(1, data.page ?? 1);
    const res = await guestlist.auth.admin.listUsers({
      query: {
        limit: USERS_PAGE_SIZE,
        offset: (page - 1) * USERS_PAGE_SIZE,
        sortBy: "createdAt",
        sortDirection: "desc",
        ...(q
          ? {
              searchValue: q,
              searchField: "email" as const,
              searchOperator: "contains" as const,
            }
          : {}),
      },
    });
    if (res.error) throw new Error(res.error.message ?? "Failed to load users");
    return {
      users: (res.data?.users ?? []) as AdminUser[],
      total: res.data?.total ?? 0,
    };
  });
