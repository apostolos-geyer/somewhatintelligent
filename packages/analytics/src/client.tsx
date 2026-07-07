// packages/analytics/src/client.tsx   →  @si/analytics/client
import { useEffect, useCallback, type ReactNode } from "react";
import { PostHogProvider, usePostHog } from "@posthog/react";
import { platformAnalyticsConfig } from "@si/config";
import type { AppName, ClientEvent, ClientEventProps } from "./events";
import type { PlatformSession } from "@si/auth";

export function AnalyticsProvider({
  app,
  environment,
  session,
  children,
}: {
  app: AppName;
  environment: string | undefined;
  session: PlatformSession | null;
  children: ReactNode;
}) {
  if (environment === "development") return <>{children}</>; // dev kill-switch
  return (
    <PostHogProvider
      apiKey={platformAnalyticsConfig.token}
      options={{
        api_host: platformAnalyticsConfig.host,
        person_profiles: "identified_only", // #1 free-tier lever: anon browsing stays cheap
        autocapture: false, // the typed registry is the ONLY event surface
        capture_pageview: "history_change", // SPA route changes
        capture_exceptions: true, // keeps the checkout captureException meaningful
        disable_session_recording: true, // biggest silent quota sink — off explicitly
        cross_subdomain_cookie: true, // www↔apex keep one distinct_id
        persistence: "localStorage+cookie",
        before_send: (e) => e && ((e.properties = { ...e.properties, app, environment }), e), // app+env on EVERY event, race-free
      }}
    >
      <AnalyticsIdentityBridge app={app} session={session} />
      {children}
    </PostHogProvider>
  );
}

// Exported for unit testing the identity-transition logic in isolation; app
// code should mount it only via AnalyticsProvider (never directly).
export function AnalyticsIdentityBridge({
  app,
  session,
}: {
  app: AppName;
  session: PlatformSession | null;
}) {
  const posthog = usePostHog();
  useEffect(() => {
    if (!posthog) return; // undefined during the very first render, before init
    const user = session?.user;
    if (user) {
      // Fire ONLY on a genuine transition TO user.id. get_distinct_id() reads the
      // PERSISTED id, so a returning logged-in user on a fresh load
      // (persisted === user.id) is skipped — no re-identify churn on reload.
      if (posthog.get_distinct_id() !== user.id) {
        // Direct A→B (token refresh / cross-tab re-login resolves session straight
        // to B, no null in between): posthog-js REFUSES identify()'s switch between
        // two identified persons, so clear A first. On a normal anon→identified
        // this is skipped (_isIdentified() === false), preserving the single merge.
        if (posthog._isIdentified()) posthog.reset();
        posthog.identify(
          user.id,
          {
            email: user.email,
            name: user.name,
            role: user.role,
            email_verified: user.emailVerified,
            two_factor_enabled: user.twoFactorEnabled,
            is_customer: (user as { stripeCustomerId?: string | null }).stripeCustomerId != null, // boolean, NOT the raw Stripe id (field managed by the stripe plugin; not in the inferred user type)
            active_organization_id: session.session.activeOrganizationId,
          }, // $set — refreshed on each transition
          { initial_signup_at: user.createdAt, initial_app: app }, // $set_once — acquisition facts
        );
      }
      // group() is an identifying call too — fire only when the org actually changes.
      const orgId = session.session.activeOrganizationId;
      if (orgId && posthog.getGroups()?.organization !== orgId) {
        posthog.group("organization", orgId);
      }
    } else if (posthog._isIdentified()) {
      posthog.reset(); // identified → anonymous ONLY — catches expiry/revocation the buttons miss
    }
  }, [posthog, session?.user?.id, session?.session.activeOrganizationId]);
  return null;
}

// consumed on the client via a typed hook — no more stringly-typed capture()
export const useCapture = () => {
  const posthog = usePostHog();
  return useCallback(
    <E extends ClientEvent>(event: E, props: ClientEventProps[E]) => posthog.capture(event, props),
    [posthog],
  );
};

// Error-tracking capture (its own quota line). Exposed here so call sites never
// import the raw @posthog/react client directly — the vendor-boundary deny test
// keeps all posthog imports inside @si/analytics.
export const useCaptureException = () => {
  const posthog = usePostHog();
  return useCallback(
    (error: unknown, additionalProperties?: Record<string, unknown>) =>
      posthog.captureException(error, additionalProperties),
    [posthog],
  );
};
