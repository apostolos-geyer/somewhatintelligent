import {
  adminClient,
  twoFactorClient,
  deviceAuthorizationClient,
  usernameClient,
  magicLinkClient,
  organizationClient,
} from "better-auth/client/plugins";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { apiKeyClient } from "@better-auth/api-key/client";

/** Client plugins matching guestlist's server plugin set. */
export const guestlistClientPlugins = () => [
  usernameClient(),
  adminClient(),
  twoFactorClient(),
  oauthProviderClient(),
  passkeyClient(),
  apiKeyClient(),
  deviceAuthorizationClient(),
  magicLinkClient(),
  organizationClient(),
];
