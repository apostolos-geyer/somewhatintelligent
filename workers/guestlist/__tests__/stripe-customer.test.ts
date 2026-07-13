/**
 * ensureStripeCustomer — the billing get-or-create RPC si's subclass adds on
 * top of the packaged Guestlist entrypoint (src/index.ts / src/stripe-customer.ts).
 *
 * The decision core (ensureStripeCustomerCore) runs against the real test D1
 * with the Stripe customer-create injected, so the create+persist+idempotency
 * path is provable without a live Stripe call. Authorization is proved end to
 * end through the real RPC (GL_RPC), where a garbage/absent cookie resolves to
 * no session before any Stripe surface is touched (INV-9).
 */
import { env } from "cloudflare:test";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import type { PlatformSession } from "@somewhatintelligent/auth";
import { ensureStripeCustomerCore, type CustomerCreator } from "../src/stripe-customer";
import { user } from "../src/schema.gen";
import { signUpVerified, uniqueEmail } from "./helpers";

const db = drizzle(env.DB);

function sessionFor(userId: string, email: string): PlatformSession {
  return { user: { id: userId, email }, session: {} } as unknown as PlatformSession;
}

/** A creator that must never fire in the branches that resolve without Stripe. */
function neverCreator(): CustomerCreator {
  return async () => {
    throw new Error("createCustomer must not be called");
  };
}

describe("ensureStripeCustomerCore", () => {
  test("no session → unauthorized (no Stripe call)", async () => {
    const res = await ensureStripeCustomerCore({
      db: env.DB,
      session: null,
      secretKey: "sk_test_x",
      createCustomer: neverCreator(),
    });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });

  test("secret key absent → stripe_unconfigured (no Stripe call)", async () => {
    const email = uniqueEmail("unconfigured");
    const { userId } = await signUpVerified({
      name: "Unconfigured",
      email,
      password: "correct-horse-battery",
    });
    const res = await ensureStripeCustomerCore({
      db: env.DB,
      session: sessionFor(userId, email),
      secretKey: undefined,
      createCustomer: neverCreator(),
    });
    expect(res).toEqual({ ok: false, error: "stripe_unconfigured" });
  });

  test("no prior customer id → creates, persists, and keys idempotently", async () => {
    const email = uniqueEmail("create");
    const { userId } = await signUpVerified({
      name: "Create Me",
      email,
      password: "correct-horse-battery",
    });

    let seenKey: string | undefined;
    let seenEmail: string | undefined;
    const createCustomer: CustomerCreator = async (input) => {
      seenKey = input.idempotencyKey;
      seenEmail = input.email;
      return "cus_created_1";
    };

    const res = await ensureStripeCustomerCore({
      db: env.DB,
      session: sessionFor(userId, email),
      secretKey: "sk_test_x",
      createCustomer,
    });

    expect(res).toEqual({ ok: true, stripeCustomerId: "cus_created_1" });
    // INV-8: the key is derived from the stable user id.
    expect(seenKey).toBe(`cust:${userId}`);
    expect(seenEmail).toBe(email);

    // Persisted for the next call.
    const [row] = await db
      .select({ stripeCustomerId: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    expect(row?.stripeCustomerId).toBe("cus_created_1");
  });

  test("existing customer id → returned without a Stripe call (idempotent)", async () => {
    const email = uniqueEmail("existing");
    const { userId } = await signUpVerified({
      name: "Already Set",
      email,
      password: "correct-horse-battery",
    });
    await db.update(user).set({ stripeCustomerId: "cus_existing_9" }).where(eq(user.id, userId));

    const res = await ensureStripeCustomerCore({
      db: env.DB,
      session: sessionFor(userId, email),
      secretKey: "sk_test_x",
      createCustomer: neverCreator(),
    });
    expect(res).toEqual({ ok: true, stripeCustomerId: "cus_existing_9" });
  });

  test("lost persist race → returns the winner's id and voids the duplicate", async () => {
    const email = uniqueEmail("race");
    const { userId } = await signUpVerified({
      name: "Race Loser",
      email,
      password: "correct-horse-battery",
    });

    // Simulate a concurrent creator winning between this call's NULL read and
    // its NULL-gated claim: the injected create itself commits the winner's id
    // before returning the loser's.
    const createCustomer: CustomerCreator = async () => {
      await db.update(user).set({ stripeCustomerId: "cus_winner" }).where(eq(user.id, userId));
      return "cus_loser";
    };
    const deleted: string[] = [];

    const res = await ensureStripeCustomerCore({
      db: env.DB,
      session: sessionFor(userId, email),
      secretKey: "sk_test_x",
      createCustomer,
      deleteCustomer: async (id) => {
        deleted.push(id);
      },
    });

    // The column is the arbiter: the winner's id is returned, the loser voided.
    expect(res).toEqual({ ok: true, stripeCustomerId: "cus_winner" });
    expect(deleted).toEqual(["cus_loser"]);
    const [row] = await db
      .select({ stripeCustomerId: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    expect(row?.stripeCustomerId).toBe("cus_winner");
  });

  test("lost-race cleanup failure is swallowed, winner still returned", async () => {
    const email = uniqueEmail("race-cleanup");
    const { userId } = await signUpVerified({
      name: "Race Cleanup",
      email,
      password: "correct-horse-battery",
    });
    const createCustomer: CustomerCreator = async () => {
      await db.update(user).set({ stripeCustomerId: "cus_winner_2" }).where(eq(user.id, userId));
      return "cus_loser_2";
    };
    const res = await ensureStripeCustomerCore({
      db: env.DB,
      session: sessionFor(userId, email),
      secretKey: "sk_test_x",
      createCustomer,
      deleteCustomer: async () => {
        throw new Error("stripe down");
      },
    });
    expect(res).toEqual({ ok: true, stripeCustomerId: "cus_winner_2" });
  });

  test("a create failure surfaces as stripe_customer_create_failed, never a throw", async () => {
    const email = uniqueEmail("failure");
    const { userId } = await signUpVerified({
      name: "Fails",
      email,
      password: "correct-horse-battery",
    });
    const res = await ensureStripeCustomerCore({
      db: env.DB,
      session: sessionFor(userId, email),
      secretKey: "sk_test_x",
      createCustomer: async () => {
        throw new Error("stripe down");
      },
    });
    expect(res).toEqual({ ok: false, error: "stripe_customer_create_failed" });
  });
});

describe("ensureStripeCustomer RPC (cookie authorization, INV-9)", () => {
  test("absent cookie → unauthorized, never another user's id", async () => {
    const res = await env.GL_RPC.ensureStripeCustomer({ cookie: "" });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });

  test("garbage cookie → unauthorized", async () => {
    const res = await env.GL_RPC.ensureStripeCustomer({
      cookie: "si.session_token=not-a-real-token",
    });
    expect(res).toEqual({ ok: false, error: "unauthorized" });
  });
});
