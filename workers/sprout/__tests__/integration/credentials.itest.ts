/**
 * Integration probe (real local D1): CanSell credential submit + admin review.
 * Replays the EXACT writes/guards the server fns make WITHOUT calling the gated
 * fns (the review fns require the platform-admin envelope; here we exercise the
 * D1 contract directly):
 *
 *  - `submitCredential` UPSERTs on (user_id, kind) → status `pending` (a re-submit
 *    UPDATES the one row, never duplicates — the UNIQUE index enforces it).
 *  - `reviewCredential` flips status → `verified` / `rejected` and stamps
 *    `verified_by` + `review_note`.
 *  - the pure `credentialState` agrees with a REAL row: verified+future → valid,
 *    verified+past → expired.
 *
 * Mirrors requests.itest.ts (self-seeding, `cloudflare:test` env, isolated D1).
 */
import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { budtenderCredentials } from "@/schema";
import { credentialState } from "@/lib/credentials";

const db = createDb(env.DB);
const KIND = "cansell";
const USER = "user_bud";
const ADMIN = "user_admin";

/** The `submitCredential` UPSERT — insert-or-update on (user_id, kind) → pending. */
async function submit(
  userId: string,
  expiresAt: number,
  opts: { credentialNumber?: string | null; proofRef?: string | null; id?: string } = {},
) {
  const now = Date.now();
  return db
    .insert(budtenderCredentials)
    .values({
      id: opts.id ?? `cred_${crypto.randomUUID()}`,
      userId,
      kind: KIND,
      issuer: "CanSell",
      credentialNumber: opts.credentialNumber ?? null,
      proofRef: opts.proofRef ?? null,
      expiresAt,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [budtenderCredentials.userId, budtenderCredentials.kind],
      set: {
        credentialNumber: opts.credentialNumber ?? null,
        // Mirror the real fn: only replace the stored blob when THIS submit
        // finalized a new one — an expiry-only update keeps the existing proof.
        ...(opts.proofRef != null ? { proofRef: opts.proofRef } : {}),
        expiresAt,
        status: "pending",
        reviewNote: null,
        verifiedBy: null,
        updatedAt: now,
      },
    });
}

/** The `reviewCredential` write — flip status + stamp verified_by + review_note. */
async function review(
  userId: string,
  decision: "verified" | "rejected",
  adminId: string,
  note: string | null,
) {
  return (
    db
      .update(budtenderCredentials)
      .set({ status: decision, reviewNote: note, verifiedBy: adminId, updatedAt: Date.now() })
      // Mirror the real fn: only a still-PENDING row is decidable, so a stale
      // decision can't clobber a row that changed since the queue was loaded.
      .where(
        and(
          eq(budtenderCredentials.userId, userId),
          eq(budtenderCredentials.kind, KIND),
          eq(budtenderCredentials.status, "pending"),
        ),
      )
      .returning({ id: budtenderCredentials.id })
  );
}

function load(userId: string) {
  return db
    .select()
    .from(budtenderCredentials)
    .where(and(eq(budtenderCredentials.userId, userId), eq(budtenderCredentials.kind, KIND)))
    .limit(1);
}

beforeEach(async () => {
  await db.delete(budtenderCredentials);
});

describe("submitCredential — UPSERT to a pending row (real D1)", () => {
  it("inserts a fresh submission as status 'pending'", async () => {
    await submit(USER, Date.now() + 86_400_000, { credentialNumber: "CS-1", proofRef: "blob_1" });
    const row = (await load(USER)).at(0)!;
    expect(row.status).toBe("pending");
    expect(row.credentialNumber).toBe("CS-1");
    expect(row.proofRef).toBe("blob_1");
    expect(row.verifiedBy).toBeNull();
    expect(row.reviewNote).toBeNull();
  });

  it("a re-submit UPDATES the one row (UNIQUE(user_id,kind) — no duplicate)", async () => {
    const future = Date.now() + 86_400_000;
    await submit(USER, future, { credentialNumber: "CS-1" });
    // Re-submit with a new number/expiry — must overwrite, not add a second row.
    await submit(USER, future + 1000, { credentialNumber: "CS-2" });

    const all = await load(USER);
    expect(all).toHaveLength(1);
    expect(all[0]!.credentialNumber).toBe("CS-2");
    expect(all[0]!.expiresAt).toBe(future + 1000);
    expect(all[0]!.status).toBe("pending");
  });

  it("re-submitting after a decision CLEARS verified_by + review_note (re-enters the queue)", async () => {
    const future = Date.now() + 86_400_000;
    await submit(USER, future);
    await review(USER, "rejected", ADMIN, "Illegible scan");
    let row = (await load(USER)).at(0)!;
    expect(row.status).toBe("rejected");
    expect(row.reviewNote).toBe("Illegible scan");

    await submit(USER, future); // re-submit
    row = (await load(USER)).at(0)!;
    expect(row.status).toBe("pending");
    expect(row.verifiedBy).toBeNull();
    expect(row.reviewNote).toBeNull();
  });

  it("a SECOND user's submission is its own row (platform-wide, keyed per user)", async () => {
    const future = Date.now() + 86_400_000;
    await submit(USER, future);
    await submit("user_other", future);
    const rows = await db.select().from(budtenderCredentials);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.userId).sort()).toEqual([USER, "user_other"].sort());
  });

  it("an update WITHOUT a new file PRESERVES the previously uploaded proof blob", async () => {
    const future = Date.now() + 86_400_000;
    await submit(USER, future, { credentialNumber: "CS-1", proofRef: "blob_1" });
    // "Update CanSell" changing only the expiry — the file input is empty, so no
    // new proofRef is threaded. The existing blob must survive (data-loss guard).
    await submit(USER, future + 5000, { credentialNumber: "CS-1" });
    const row = (await load(USER)).at(0)!;
    expect(row.proofRef).toBe("blob_1");
    expect(row.expiresAt).toBe(future + 5000);
  });
});

describe("reviewCredential — admin decision stamps the row (real D1)", () => {
  it("verified: status → 'verified' + verified_by = admin, note recorded", async () => {
    await submit(USER, Date.now() + 86_400_000);
    const updated = await review(USER, "verified", ADMIN, "Looks good");
    expect(updated).toHaveLength(1);
    const row = (await load(USER)).at(0)!;
    expect(row.status).toBe("verified");
    expect(row.verifiedBy).toBe(ADMIN);
    expect(row.reviewNote).toBe("Looks good");
  });

  it("rejected: status → 'rejected' + the reject note reaches the budtender", async () => {
    await submit(USER, Date.now() + 86_400_000);
    await review(USER, "rejected", ADMIN, "Expired certificate uploaded");
    const row = (await load(USER)).at(0)!;
    expect(row.status).toBe("rejected");
    expect(row.verifiedBy).toBe(ADMIN);
    expect(row.reviewNote).toBe("Expired certificate uploaded");
  });

  it("reviewing an unknown user is a no-op (returns nothing → the fn throws not_found)", async () => {
    const updated = await review("nobody", "verified", ADMIN, null);
    expect(updated).toHaveLength(0);
  });

  it("a stale decision does NOT clobber an already-decided row (status='pending' guard)", async () => {
    await submit(USER, Date.now() + 86_400_000);
    // Admin B verifies first.
    const first = await review(USER, "verified", ADMIN, "Looks good");
    expect(first).toHaveLength(1);
    // Admin A, acting on a stale queue, tries to Reject — the row is no longer
    // pending, so the guarded UPDATE matches nothing and the verified state holds.
    const stale = await review(USER, "rejected", "user_admin2", "too late");
    expect(stale).toHaveLength(0);
    const row = (await load(USER)).at(0)!;
    expect(row.status).toBe("verified");
    expect(row.verifiedBy).toBe(ADMIN);
    expect(row.reviewNote).toBe("Looks good");
  });
});

describe("credentialState over a REAL reviewed row", () => {
  it("a verified row with a FUTURE expiry derives 'valid'", async () => {
    const future = Date.now() + 86_400_000;
    await submit(USER, future);
    await review(USER, "verified", ADMIN, null);
    const row = (await load(USER)).at(0)!;
    expect(credentialState(row, Date.now())).toBe("valid");
  });

  it("a verified row with a PAST expiry derives 'expired'", async () => {
    const past = Date.now() - 86_400_000;
    await submit(USER, past);
    await review(USER, "verified", ADMIN, null);
    const row = (await load(USER)).at(0)!;
    expect(credentialState(row, Date.now())).toBe("expired");
  });

  it("a still-pending row derives 'pending'; a rejected row derives 'rejected'", async () => {
    const future = Date.now() + 86_400_000;
    await submit(USER, future);
    expect(credentialState((await load(USER)).at(0)!, Date.now())).toBe("pending");
    await review(USER, "rejected", ADMIN, "no");
    expect(credentialState((await load(USER)).at(0)!, Date.now())).toBe("rejected");
  });
});
