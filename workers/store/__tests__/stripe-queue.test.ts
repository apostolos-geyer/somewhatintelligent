import { consumeStripeEventBatch } from "../src/lib/stripe-queue";
import { processStoreStripeEvent } from "@/lib/stripe-events";
import type { StoreStripeEventMessage } from "../src/lib/stripe-webhook";
import type { ProcessStripeEventResult } from "@/lib/stripe-events";

// Mock the processor so this suite tests the DISPATCH contract (ack/retry
// isolation + concurrency), not the D1 ingestion logic (covered by the itest).
vi.mock("@/lib/stripe-events", () => ({ processStoreStripeEvent: vi.fn() }));

const process = vi.mocked(processStoreStripeEvent);

type FakeMessage = {
  id: string;
  attempts: number;
  body: StoreStripeEventMessage;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
};

function fakeMessage(id: string, type = "checkout.session.completed", attempts = 1): FakeMessage {
  return {
    id,
    attempts,
    body: { id, type, created: 0, livemode: false, objectId: `cs_${id}` },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function fakeBatch(...messages: FakeMessage[]) {
  return {
    queue: "si-stripe-events-staging",
    messages,
  } as unknown as MessageBatch<StoreStripeEventMessage>;
}

const db = {} as never;
const env = { ENVIRONMENT: "staging" } as const;
const applied: ProcessStripeEventResult = { ok: true, outcome: "applied" };

beforeEach(() => {
  process.mockReset();
});

describe("consumeStripeEventBatch", () => {
  it("dispatches messages concurrently (overlap, not serial)", async () => {
    process.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(applied), 40)),
    );
    const batch = fakeBatch(fakeMessage("a"), fakeMessage("b"), fakeMessage("c"));

    const start = Date.now();
    await consumeStripeEventBatch(db, batch, env);
    const elapsed = Date.now() - start;

    // Serial would be ~120ms; concurrent tracks a single ~40ms delay period.
    expect(elapsed).toBeLessThan(100);
    for (const m of batch.messages as unknown as FakeMessage[])
      expect(m.ack).toHaveBeenCalledTimes(1);
  });

  it("isolates a throwing message: only it retries, siblings ack, batch resolves", async () => {
    process.mockImplementation(async (_db, message) => {
      if (message.id === "boom") throw new Error("d1 down");
      return applied;
    });
    const [ok1, boom, ok2] = [fakeMessage("ok1"), fakeMessage("boom"), fakeMessage("ok2")];

    await expect(
      consumeStripeEventBatch(db, fakeBatch(ok1, boom, ok2), env),
    ).resolves.toBeUndefined();

    expect(ok1.ack).toHaveBeenCalledTimes(1);
    expect(ok1.retry).not.toHaveBeenCalled();
    expect(ok2.ack).toHaveBeenCalledTimes(1);
    // A thrown (transient) error retries with backoff (attempts=1 → 30s).
    expect(boom.retry).toHaveBeenCalledTimes(1);
    expect(boom.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(boom.ack).not.toHaveBeenCalled();
  });

  it("retryable outcome → retry() with backoff, never ack()", async () => {
    process.mockResolvedValue({ ok: false, outcome: "retryable" });
    const m = fakeMessage("r");
    await consumeStripeEventBatch(db, fakeBatch(m), env);
    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(m.ack).not.toHaveBeenCalled();
  });

  it("retry backoff escalates with attempts, capped at 300s", async () => {
    process.mockResolvedValue({ ok: false, outcome: "retryable" });
    // attempts=1 → 30s, attempts=6 → 180s, attempts=12 → 300s (30*12=360 capped).
    const [a1, a6, a12] = [
      fakeMessage("a1", "checkout.session.completed", 1),
      fakeMessage("a6", "checkout.session.completed", 6),
      fakeMessage("a12", "checkout.session.completed", 12),
    ];
    await consumeStripeEventBatch(db, fakeBatch(a1, a6, a12), env);
    expect(a1.retry).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(a6.retry).toHaveBeenCalledWith({ delaySeconds: 180 });
    expect(a12.retry).toHaveBeenCalledWith({ delaySeconds: 300 });
  });

  it.each(["applied", "duplicate", "ignored"] as const)(
    "%s outcome → ack(), never retry()",
    async (outcome) => {
      process.mockResolvedValue({ ok: true, outcome });
      const m = fakeMessage("k");
      await consumeStripeEventBatch(db, fakeBatch(m), env);
      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(m.retry).not.toHaveBeenCalled();
    },
  );
});
