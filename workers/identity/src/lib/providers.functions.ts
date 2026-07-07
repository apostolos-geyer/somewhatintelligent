import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "./guestlist";

export type SocialProviders = {
  google: boolean;
  microsoft: boolean;
  facebook: boolean;
  linkedin: boolean;
};

const DISABLED: SocialProviders = {
  google: false,
  microsoft: false,
  facebook: false,
  linkedin: false,
};

export const loadProviders = createServerFn({ method: "GET" }).handler(
  async (): Promise<SocialProviders> => {
    const { data } = await getGuestlist().api.providers.get();
    return data?.social ?? DISABLED;
  },
);
