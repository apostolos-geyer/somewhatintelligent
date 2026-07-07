/**
 * Code-readable platform constants. Edit this file when rebranding a fork.
 *
 * For values that change between environments (URLs, account IDs, D1 IDs),
 * see ./deploy.ts.
 */
export const platformConfig = {
  brand: {
    /** Full product/brand name. Shown in wordmarks, page titles, button text. */
    name: "Sprout",
    /** Short uppercase wordmark variant (used in stacked logo layout). */
    short: "SPROUT",
    /**
     * Support address for outbound transactional email. Using hello@ as the
     * friendly front-door inbox (grow@sproutportal.ca is the on-brand alternative).
     */
    supportEmail: "hello@sproutportal.ca",
  },
  cookies: {
    /**
     * Prefix for every session-related cookie issued by the platform.
     * The wire cookie names become e.g. `<prefix>.session_token`,
     * `<prefix>.session_data`. Used as the better-auth `cookiePrefix`.
     */
    prefix: "sprout",
  },
  auth: {
    /**
     * Provider id used when first-party apps consume guestlist-as-OAuth-provider
     * via better-auth's generic-OAuth plugin. Must match between guestlist's
     * `oauthProvider({ providerId })` and each app's `genericOAuth({ providerId })`.
     */
    providerId: "sprout",
    /** Human-visible WebAuthn relying-party name shown in the OS passkey UI. */
    passkeyRpName: "Sprout",
    /** Issuer label for TOTP / 2FA (shown in Authenticator apps). */
    twoFactorIssuer: "Sprout",
  },
} as const;

export type PlatformConfig = typeof platformConfig;
