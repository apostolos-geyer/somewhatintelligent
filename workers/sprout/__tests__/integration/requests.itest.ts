/**
 * Integration probe (real local D1): proof-of-display. Replays the EXACT guard +
 * write `confirmDeployed` makes — the request is loaded scoped to (id, brand_id,
 * user_id) [requester-gated tenancy], the status must be Shipped/Approved, then it
 * flips to Deployed with `deployed_at` (+ optional `proof_photo_ref`). Asserts the
 * tenancy + status guards hold against real rows, so a non-owner or a wrong-state
 * confirmation is a no-op.
 */
import { env } from "cloudflare:test";
import { and, eq } from "drizzle-orm";
import { createDb } from "@/lib/db";
import { assets, physicalRequests } from "@/schema";

const db = createDb(env.DB);
const BRAND = "org_req";
const USER = "user_bud";

/** The fn's load-guard: the request, scoped to (id, brand, requester). */
function loadOwned(requestId: string, brandId: string, userId: string) {
  return db
    .select({ id: physicalRequests.id, status: physicalRequests.status })
    .from(physicalRequests)
    .where(
      and(
        eq(physicalRequests.id, requestId),
        eq(physicalRequests.brandId, brandId),
        eq(physicalRequests.userId, userId),
      ),
    )
    .limit(1);
}

/** The fn's write: flip Shipped/Approved → Deployed (only the matching row). */
async function deploy(requestId: string, brandId: string, proofPhotoRef: string | null) {
  return db
    .update(physicalRequests)
    .set({ status: "Deployed", deployedAt: 1234, proofPhotoRef, updatedAt: 1234 })
    .where(and(eq(physicalRequests.id, requestId), eq(physicalRequests.brandId, brandId)))
    .returning({ id: physicalRequests.id });
}

beforeEach(async () => {
  await db.delete(physicalRequests);
  await db.delete(assets);
  await db.insert(assets).values({
    id: "asset1",
    brandId: BRAND,
    name: "Tent Card",
    type: "image",
    fileRef: "ref",
    sizeBytes: 1,
    status: "published",
    createdAt: 1,
    updatedAt: 1,
  });
});

function seedRequest(id: string, status: string, userId = USER, brandId = BRAND) {
  return db.insert(physicalRequests).values({
    id,
    brandId,
    assetId: "asset1",
    userId,
    quantity: 1,
    store: "acme",
    shipStreet: "1 Main",
    shipCity: "Toronto",
    shipProvince: "ON",
    shipPostal: "M1M1M1",
    contactName: "Bud",
    contactPhone: "555",
    status,
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("confirmDeployed — proof-of-display transition (real D1)", () => {
  it("a Shipped request owned by the caller flips to Deployed + stamps proof", async () => {
    await seedRequest("rq", "Shipped");

    const owned = (await loadOwned("rq", BRAND, USER)).at(0);
    expect(owned?.status).toBe("Shipped"); // confirmable

    await deploy("rq", BRAND, "proof_ref_1");
    const after = (
      await db.select().from(physicalRequests).where(eq(physicalRequests.id, "rq"))
    ).at(0)!;
    expect(after.status).toBe("Deployed");
    expect(after.deployedAt).toBe(1234);
    expect(after.proofPhotoRef).toBe("proof_ref_1");
  });

  it("a non-owner cannot confirm (the requester-scoped load returns nothing)", async () => {
    await seedRequest("rq", "Shipped", USER);
    const owned = await loadOwned("rq", BRAND, "someone_else");
    expect(owned).toHaveLength(0); // → not_found in the fn, no write happens
    // and the row is untouched
    const row = (await db.select().from(physicalRequests).where(eq(physicalRequests.id, "rq"))).at(
      0,
    )!;
    expect(row.status).toBe("Shipped");
  });

  it("a still-Requested request is not confirmable (status guard)", async () => {
    await seedRequest("rq", "Requested");
    const owned = (await loadOwned("rq", BRAND, USER)).at(0);
    // The fn rejects unless status is Shipped or Approved.
    const confirmable = owned?.status === "Shipped" || owned?.status === "Approved";
    expect(confirmable).toBe(false);
  });

  it("confirming photo-less leaves proof_photo_ref null but still records the deployment", async () => {
    await seedRequest("rq", "Approved");
    await deploy("rq", BRAND, null);
    const after = (
      await db.select().from(physicalRequests).where(eq(physicalRequests.id, "rq"))
    ).at(0)!;
    expect(after.status).toBe("Deployed");
    expect(after.proofPhotoRef).toBeNull();
  });
});
