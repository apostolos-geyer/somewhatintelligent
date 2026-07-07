import { createGuestlistClient } from "@si/guestlist-service/client";
import { env } from "cloudflare:workers";
import { createGuestlistFactory } from "@si/kit/react-start";
import { createServerOnlyFn } from "@tanstack/react-start";

export const guestlistFetcher = createServerOnlyFn(() => env.GUESTLIST.fetch.bind(env.GUESTLIST));

// The kit factory types cookie options loosely so it doesn't depend on
// `cookie-es` types; the guestlist client validates the actual
// `CookieSerializeOptions` shape internally, so the cast is sound.
export const getGuestlist = createGuestlistFactory({
  callerApp: "identity",
  createClient: createGuestlistClient as Parameters<
    typeof createGuestlistFactory<ReturnType<typeof createGuestlistClient>>
  >[0]["createClient"],
  fetcher: guestlistFetcher as () => typeof fetch,
});
