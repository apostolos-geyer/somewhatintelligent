// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vite-plus/test";
import { render, cleanup } from "@testing-library/react";
import type { PlatformSession } from "@somewhatintelligent/auth";

const posthog = vi.hoisted(() => ({
  get_distinct_id: vi.fn(() => "anon-device-id"),
  _isIdentified: vi.fn(() => false),
  identify: vi.fn(),
  reset: vi.fn(),
  group: vi.fn(),
  getGroups: vi.fn(() => ({})),
  capture: vi.fn(),
}));

vi.mock("@posthog/react", () => ({ usePostHog: () => posthog }));

import { AnalyticsIdentityBridge } from "../client";

function makeSession(
  overrides: {
    userId?: string;
    activeOrganizationId?: string | null;
  } = {},
): PlatformSession {
  const { userId = "u1", activeOrganizationId = null } = overrides;
  return {
    user: {
      id: userId,
      email: `${userId}@example.com`,
      name: `User ${userId}`,
      role: "member",
      emailVerified: true,
      twoFactorEnabled: false,
      stripeCustomerId: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    session: {
      activeOrganizationId,
    },
  } as unknown as PlatformSession;
}

beforeEach(() => {
  vi.clearAllMocks();
  posthog.get_distinct_id.mockReturnValue("anon-device-id");
  posthog._isIdentified.mockReturnValue(false);
  posthog.getGroups.mockReturnValue({});
});

afterEach(() => {
  cleanup();
});

describe("AnalyticsIdentityBridge", () => {
  it("anon -> identified: identifies the user and does not reset", () => {
    posthog.get_distinct_id.mockReturnValue("anon-device-id");
    posthog._isIdentified.mockReturnValue(false);
    const session = makeSession({ userId: "u1" });

    render(<AnalyticsIdentityBridge app="identity" session={session} />);

    expect(posthog.identify).toHaveBeenCalledTimes(1);
    const [distinctId, setProps, setOnceProps] = posthog.identify.mock.calls[0];
    expect(distinctId).toBe("u1");
    expect(setProps).toMatchObject({
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      email_verified: session.user.emailVerified,
      two_factor_enabled: session.user.twoFactorEnabled,
      is_customer: false,
      active_organization_id: null,
    });
    expect(setOnceProps).toMatchObject({
      initial_signup_at: session.user.createdAt,
      initial_app: "identity",
    });
    expect(posthog.reset).not.toHaveBeenCalled();
  });

  it("returning user reload: dedups and does not re-identify", () => {
    posthog.get_distinct_id.mockReturnValue("u1");
    posthog._isIdentified.mockReturnValue(true);
    const session = makeSession({ userId: "u1" });

    render(<AnalyticsIdentityBridge app="identity" session={session} />);

    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("direct A -> B switch: resets before identifying the new user", () => {
    posthog.get_distinct_id.mockReturnValue("uA");
    posthog._isIdentified.mockReturnValue(true);
    const session = makeSession({ userId: "uB" });

    render(<AnalyticsIdentityBridge app="identity" session={session} />);

    expect(posthog.reset).toHaveBeenCalledTimes(1);
    expect(posthog.identify).toHaveBeenCalledTimes(1);
    expect(posthog.identify.mock.calls[0][0]).toBe("uB");
    expect(posthog.reset.mock.invocationCallOrder[0]).toBeLessThan(
      posthog.identify.mock.invocationCallOrder[0],
    );
  });

  it("logout: resets and does not identify", () => {
    posthog._isIdentified.mockReturnValue(true);

    render(<AnalyticsIdentityBridge app="identity" session={null} />);

    expect(posthog.reset).toHaveBeenCalledTimes(1);
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("group on org: fires group() when the org isn't already set, skips when it is", () => {
    posthog.get_distinct_id.mockReturnValue("u1");
    posthog._isIdentified.mockReturnValue(false);
    posthog.getGroups.mockReturnValue({});
    const session = makeSession({ userId: "u1", activeOrganizationId: "org-1" });

    render(<AnalyticsIdentityBridge app="identity" session={session} />);

    expect(posthog.identify).not.toHaveBeenCalled();
    expect(posthog.group).toHaveBeenCalledWith("organization", "org-1");

    vi.clearAllMocks();
    posthog.get_distinct_id.mockReturnValue("u1");
    posthog._isIdentified.mockReturnValue(false);
    posthog.getGroups.mockReturnValue({ organization: "org-1" });

    render(<AnalyticsIdentityBridge app="identity" session={session} />);

    expect(posthog.group).not.toHaveBeenCalled();
  });
});
