import { DLQ_QUEUE_PATTERN, processDlqBatch } from "../src/lib/stripe-queue";
import { processStoreStripeEvent } from "@/lib/stripe-events";
import type { StoreStripeEventMessage } from "../src/lib/stripe-webhook";

// Mock the processor: the DLQ path's contract is "best-effort reprocess, then
// ALWAYS ack, never retry" — independent of the ingestion internals.
vi.mock("@/lib/stripe-events", () => ({ processStoreStripeEvent: vi.fn() }));

const process = vi.mocked(processStoreStripeEvent);

type FakeMessage = {
  id: string;
  attempts: number;
  body: StoreStripeEventMessage;
  ack: ReturnType<typeof vi.fn>;
  retry: ReturnType<typeof vi.fn>;
};

function fakeMessage(id: string, type = "checkout.session.completed"): FakeMessage {
  return {
    id,
    attempts: 6,
    body: { id, type, created: 0, livemode: false, objectId: `cs_${id}` },
    ack: vi.fn(),
    retry: vi.fn(),
  };
}

function fakeBatch(queue: string, ...messages: FakeMessage[]) {
  return { queue, messages } as unknown as MessageBatch<StoreStripeEventMessage>;
}

const db = {} as never;
const env = { ENVIRONMENT: "staging" } as const;

beforeEach(() => {
  process.mockReset();
  vi.restoreAllMocks();
});

describe("DLQ_QUEUE_PATTERN routing", () => {
  it("matches both env DLQ names but not the main queues", () => {
    expect(DLQ_QUEUE_PATTERN.test("si-stripe-events-dlq-staging")).toBe(true);
    expect(DLQ_QUEUE_PATTERN.test("si-stripe-events-dlq-production")).toBe(true);
    expect(DLQ_QUEUE_PATTERN.test("si-stripe-events-staging")).toBe(false);
    expect(DLQ_QUEUE_PATTERN.test("si-stripe-events-production")).toBe(false);
  });
});

describe("processDlqBatch", () => {
  it("reprocess succeeds → ack, no error log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.mockResolvedValue({ ok: true, outcome: "applied" });
    const m = fakeMessage("d1");

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-staging", m), env);

    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("reprocess throws → one console.error with event/queue/attempts, still ack, never retry", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.mockRejectedValue(new Error("still broken"));
    const m = fakeMessage("d2", "checkout.session.async_payment_failed");

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-production", m), env);

    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [label, payload] = errorSpy.mock.calls[0]!;
    expect(label).toBe("stripe_dlq_reprocess_failed");
    expect(payload).toMatchObject({
      eventId: "d2",
      eventType: "checkout.session.async_payment_failed",
      queue: "si-stripe-events-dlq-production",
      attempts: 6,
    });
  });

  it("acks every message in a multi-message batch even when some throw", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.mockImplementation(async (_db, message) => {
      if (message.id === "bad") throw new Error("boom");
      return { ok: true, outcome: "applied" };
    });
    const [good, bad] = [fakeMessage("good"), fakeMessage("bad")];

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-staging", good, bad), env);

    expect(good.ack).toHaveBeenCalledTimes(1);
    expect(bad.ack).toHaveBeenCalledTimes(1);
    expect(good.retry).not.toHaveBeenCalled();
    expect(bad.retry).not.toHaveBeenCalled();
  });
});
