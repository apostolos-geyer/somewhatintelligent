import { describe, it, expect, vi, beforeEach } from "vite-plus/test";

// No cloudflare:workers mock — the package is platform-agnostic; `environment`
// is passed in as a plain argument by the caller (the worker).
vi.mock("posthog-node", () => {
  const captureImmediate = vi.fn().mockResolvedValue(undefined);
  return {
    PostHog: vi.fn(function PostHog() {
      return { captureImmediate };
    }),
    __captureImmediate: captureImmediate,
  };
});

vi.mock("@si/kit/execution-context", () => ({
  executionContext: { getStore: vi.fn() },
}));

import * as posthogNode from "posthog-node";
import { executionContext } from "@si/kit/execution-context";
import { deliverIdentified, deliverAnonymous } from "../server/delivery";

const captureImmediate = (posthogNode as any).__captureImmediate;

describe("delivery", () => {
  beforeEach(() => {
    captureImmediate.mockClear();
    (executionContext.getStore as any).mockReset();
  });

  it("deliverIdentified calls captureImmediate once with the expected payload", async () => {
    (executionContext.getStore as any).mockReturnValue(undefined);

    await deliverIdentified(
      "store",
      "user-1",
      "order_placed",
      {
        order_number: "SI-1",
        item_count: 2,
        subtotal_cents: 100,
        shipping_cents: 0,
        total_cents: 100,
      },
      "staging",
      { organization: "org-1" },
    );

    expect(captureImmediate).toHaveBeenCalledTimes(1);
    expect(captureImmediate).toHaveBeenCalledWith({
      distinctId: "user-1",
      event: "order_placed",
      properties: {
        order_number: "SI-1",
        item_count: 2,
        subtotal_cents: 100,
        shipping_cents: 0,
        total_cents: 100,
        app: "store",
        environment: "staging",
      },
      groups: { organization: "org-1" },
    });
  });

  it("routes through ctx.waitUntil when a ctx is seeded", async () => {
    const waitUntil = vi.fn();
    (executionContext.getStore as any).mockReturnValue({ waitUntil });

    await deliverIdentified(
      "store",
      "user-1",
      "order_placed",
      {
        order_number: "SI-2",
        item_count: 1,
        subtotal_cents: 50,
        shipping_cents: 0,
        total_cents: 50,
      },
      "staging",
      { organization: "org-1" },
    );

    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(waitUntil.mock.calls[0][0]).toBeInstanceOf(Promise);
    // deliver resolved without needing to await the captured send promise itself
    expect(captureImmediate).toHaveBeenCalledTimes(1);
  });

  it("awaits the send directly when there is no seeded ctx", async () => {
    (executionContext.getStore as any).mockReturnValue(undefined);

    let resolved = false;
    captureImmediate.mockImplementationOnce(() => Promise.resolve().then(() => (resolved = true)));

    const promise = deliverIdentified(
      "store",
      "user-1",
      "order_placed",
      {
        order_number: "SI-3",
        item_count: 1,
        subtotal_cents: 50,
        shipping_cents: 0,
        total_cents: 50,
      },
      "staging",
      { organization: "org-1" },
    );

    await promise;
    expect(resolved).toBe(true);
  });

  it("deliverAnonymous stamps $process_person_profile:false and a ulid distinctId", async () => {
    (executionContext.getStore as any).mockReturnValue(undefined);

    await deliverAnonymous(
      "store",
      "order_placed",
      {
        order_number: "SI-4",
        item_count: 3,
        subtotal_cents: 200,
        shipping_cents: 10,
        total_cents: 210,
      },
      "staging",
    );

    expect(captureImmediate).toHaveBeenCalledTimes(1);
    const payload = captureImmediate.mock.calls[0][0];

    expect(payload.properties.$process_person_profile).toBe(false);
    expect(payload.properties.app).toBe("store");
    expect(payload.properties.environment).toBe("staging");
    expect(typeof payload.distinctId).toBe("string");
    expect(payload.distinctId.length).toBeGreaterThan(0);
    expect(payload.distinctId).not.toBe("user-1");
  });
});
