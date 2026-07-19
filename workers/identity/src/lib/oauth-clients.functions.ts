import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";

export const resolveClientName = createServerFn({ method: "POST" })
  .validator((data: { client_id: string; oauth_query: string }) => data)
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const res = await guestlist.auth.oauth2.publicClientPrelogin({
      client_id: data.client_id,
      oauth_query: data.oauth_query,
    });
    return res.data?.client_name ?? null;
  });
