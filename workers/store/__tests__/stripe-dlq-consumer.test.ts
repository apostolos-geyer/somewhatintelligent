import { DLQ_QUEUE_PATTERN, processDlqBatch } from "../src/lib/stripe-queue";
import { processStoreStripeEvent } from "@/lib/stripe-events";
import type { Db } from "@/lib/db";
import type { StoreStripeEventMessage } from "../src/lib/stripe-webhook";

// Mock the processor: the DLQ path's contract is "reprocess once; recover
// (ack) OR persist forensics into dead_stripe_event then ack; persist failure
// retries" — independent of the ingestion internals.
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

// A db whose dead-letter upsert is observable; `persistThrows` simulates D1 down
// so the INSERT (`db.insert(...).values(...).onConflictDoUpdate(...)`) rejects.
function fakeDb(opts: { persistThrows?: boolean } = {}) {
  const onConflictDoUpdate = vi.fn(() =>
    opts.persistThrows ? Promise.reject(new Error("d1 down")) : Promise.resolve(undefined),
  );
  const values = vi.fn(() => ({ onConflictDoUpdate }));
  const insert = vi.fn(() => ({ values }));
  return { db: { insert } as unknown as Db, insert, values, onConflictDoUpdate };
}

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
  it("reprocess recovers (applied) → ack, no dead-letter row, no error log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.mockResolvedValue({ ok: true, outcome: "applied" });
    const { db, insert } = fakeDb();
    const m = fakeMessage("d1");

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-staging", m), env);

    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    // A recovery is noted (not an error).
    expect(logSpy).toHaveBeenCalledWith(
      "stripe_dlq_event_recovered",
      expect.objectContaining({ eventId: "d1" }),
    );
  });

  it.each(["duplicate", "ignored"] as const)(
    "reprocess recovers (%s) → ack, no dead-letter row",
    async (outcome) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.mockResolvedValue({ ok: true, outcome });
      const { db, insert } = fakeDb();
      const m = fakeMessage("k");

      await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-staging", m), env);

      expect(m.ack).toHaveBeenCalledTimes(1);
      expect(insert).not.toHaveBeenCalled();
    },
  );

  it("retryable outcome → dead-letter persist (retryable_exhausted) + stripe_dlq_event_dead + ack", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.mockResolvedValue({ ok: false, outcome: "retryable" });
    const { db, values, onConflictDoUpdate } = fakeDb();
    const m = fakeMessage("d1");

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-production", m), env);

    // Evidence landed BEFORE the ack, keyed on the event id with the reason.
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "d1",
        eventType: "checkout.session.completed",
        objectId: "cs_d1",
        attempts: 6,
        reason: "retryable_exhausted",
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "stripe_dlq_event_dead",
      expect.objectContaining({
        eventId: "d1",
        eventType: "checkout.session.completed",
        objectId: "cs_d1",
        reason: "retryable_exhausted",
        attempts: 6,
        queue: "si-stripe-events-dlq-production",
      }),
    );
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("reprocess throws → dead-letter persist (reprocess_threw) + stripe_dlq_event_dead + ack", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.mockRejectedValue(new Error("still broken"));
    const { db, values } = fakeDb();
    const m = fakeMessage("d2", "checkout.session.async_payment_failed");

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-production", m), env);

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ reason: "reprocess_threw" }));
    expect(errorSpy).toHaveBeenCalledWith(
      "stripe_dlq_event_dead",
      expect.objectContaining({
        eventId: "d2",
        eventType: "checkout.session.async_payment_failed",
        reason: "reprocess_threw",
      }),
    );
    expect(m.ack).toHaveBeenCalledTimes(1);
    expect(m.retry).not.toHaveBeenCalled();
  });

  it("dead-letter persist itself fails (D1 down) → stripe_dlq_persist_failed + retry, never ack", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    process.mockResolvedValue({ ok: false, outcome: "retryable" });
    const { db } = fakeDb({ persistThrows: true });
    const m = fakeMessage("d3");

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-staging", m), env);

    expect(errorSpy).toHaveBeenCalledWith(
      "stripe_dlq_persist_failed",
      expect.objectContaining({ eventId: "d3", reason: "retryable_exhausted" }),
    );
    // Evidence never landed, so the DLQ redelivery becomes the persistence retry.
    expect(m.retry).toHaveBeenCalledTimes(1);
    expect(m.ack).not.toHaveBeenCalled();
    // The terminal "dead" line is NOT emitted when persistence failed.
    expect(errorSpy).not.toHaveBeenCalledWith("stripe_dlq_event_dead", expect.anything());
  });

  it("acks every message in a multi-message batch (recover + dead-letter mix)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    process.mockImplementation(async (_db, message) => {
      if (message.id === "dead") return { ok: false, outcome: "retryable" };
      return { ok: true, outcome: "applied" };
    });
    const { db } = fakeDb();
    const [good, dead] = [fakeMessage("good"), fakeMessage("dead")];

    await processDlqBatch(db, fakeBatch("si-stripe-events-dlq-staging", good, dead), env);

    expect(good.ack).toHaveBeenCalledTimes(1);
    expect(dead.ack).toHaveBeenCalledTimes(1);
    expect(good.retry).not.toHaveBeenCalled();
    expect(dead.retry).not.toHaveBeenCalled();
  });
});
