/**
 * Physical-asset request + fulfilment server functions (P4.A) — the budtender
 * orders a printed copy of a `physical_available` asset; the brand works the
 * fulfilment queue. Two tenancy modes, per the §02 invariant (brand_id is NEVER
 * input):
 *
 *  - The budtender paths (`requestPhysical`, `listMyRequests`) gate with
 *    `requireUserMiddleware` and scope every row to the verified envelope's
 *    `activeOrgId`. A request can only be opened against an asset whose
 *    `brand_id === activeOrgId AND physical_available = 1`; a forged/foreign/
 *    download-only `assetId` resolves to "not found", never another brand's asset.
 *    `listMyRequests` returns only the caller's own rows (the status view the
 *    `fulfilment_status` notification deep-links into).
 *  - The Brand-Admin paths (`listFulfilmentQueue`, `decideFulfilment`) gate
 *    IN-HANDLER on `decideBrandAdmin({ actorRole, orgRole })` (owner|admin in the
 *    brand's BA org, or platform admin). `decideFulfilment` advances one request
 *    through Requested → Approved → Shipped (optional tracking) / Declined
 *    (reason), `writeAudit`s the transition, and `emitNotification`s the requester
 *    on every transition (the IN-PLATFORM channel — the product has no email
 *    client; the promoter email mirror is deferred).
 *
 * A new request emits a `physical_request` analytics event (the engagement signal
 * the dashboards count). The requester is NOT notified on open — they made the
 * request; notifications are reserved for the brand's fulfilment decisions.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, desc, eq, isNull } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { assets, physicalRequests } from "@/schema";
import { getRoadie } from "@/lib/roadie";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { nullableTrim } from "@/lib/strings";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";
import { emitNotification } from "@/lib/notify";

/** The fulfilment lifecycle, in transition order. Requested is the open state;
 *  Deployed is the budtender's proof-of-display confirmation after Shipped. */
export const REQUEST_STATUSES = [
  "Requested",
  "Approved",
  "Shipped",
  "Deployed",
  "Declined",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export function isRequestStatus(v: unknown): v is RequestStatus {
  return typeof v === "string" && (REQUEST_STATUSES as readonly string[]).includes(v);
}

function asStatus(v: string): RequestStatus {
  return isRequestStatus(v) ? v : "Requested";
}

/** A request as the caller's "My Requests" status view renders one row. */
export interface MyRequestView {
  id: string;
  assetId: string;
  assetName: string;
  quantity: number;
  store: string;
  status: RequestStatus;
  tracking: string | null;
  declineReason: string | null;
  /** Set once the budtender confirms the display is up; the photo handle (if any). */
  proofPhotoRef: string | null;
  deployedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

/** A request as the admin fulfilment queue renders one row (adds shipping + requester). */
export interface FulfilmentRequestView extends MyRequestView {
  userId: string;
  shipStreet: string;
  shipCity: string;
  shipProvince: string;
  shipPostal: string;
  contactName: string;
  contactPhone: string;
  note: string | null;
  /** Resolved proof-of-display photo URL (roadie), or null — the LP's view. */
  proofPhotoUrl: string | null;
}

// Drizzle returns rows keyed by the schema's camelCase TS fields; the join
// projection below carries the asset name alongside the request row, mapped to
// the view shape at the I/O edge.
type RequestRow = {
  id: string;
  assetId: string;
  assetName: string;
  userId: string;
  quantity: number;
  store: string;
  shipStreet: string;
  shipCity: string;
  shipProvince: string;
  shipPostal: string;
  contactName: string;
  contactPhone: string;
  note: string | null;
  status: string;
  tracking: string | null;
  declineReason: string | null;
  proofPhotoRef: string | null;
  deployedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

function mapMyRequest(row: RequestRow): MyRequestView {
  return {
    id: row.id,
    assetId: row.assetId,
    assetName: row.assetName,
    quantity: row.quantity,
    store: row.store,
    status: asStatus(row.status),
    tracking: row.tracking,
    declineReason: row.declineReason,
    proofPhotoRef: row.proofPhotoRef,
    deployedAt: row.deployedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Maps a row to the admin view; `proofPhotoUrl` resolved separately (async). */
function mapFulfilment(row: RequestRow): FulfilmentRequestView {
  return {
    ...mapMyRequest(row),
    userId: row.userId,
    shipStreet: row.shipStreet,
    shipCity: row.shipCity,
    shipProvince: row.shipProvince,
    shipPostal: row.shipPostal,
    contactName: row.contactName,
    contactPhone: row.contactPhone,
    note: row.note,
    proofPhotoUrl: null,
  };
}

// The shared join projection — the asset name rides every row for display.
const REQUEST_COLS = {
  id: physicalRequests.id,
  assetId: physicalRequests.assetId,
  assetName: assets.name,
  userId: physicalRequests.userId,
  quantity: physicalRequests.quantity,
  store: physicalRequests.store,
  shipStreet: physicalRequests.shipStreet,
  shipCity: physicalRequests.shipCity,
  shipProvince: physicalRequests.shipProvince,
  shipPostal: physicalRequests.shipPostal,
  contactName: physicalRequests.contactName,
  contactPhone: physicalRequests.contactPhone,
  note: physicalRequests.note,
  status: physicalRequests.status,
  tracking: physicalRequests.tracking,
  declineReason: physicalRequests.declineReason,
  proofPhotoRef: physicalRequests.proofPhotoRef,
  deployedAt: physicalRequests.deployedAt,
  createdAt: physicalRequests.createdAt,
  updatedAt: physicalRequests.updatedAt,
} as const;

// ─── budtender paths (authenticated, envelope-scoped) ───────────────────────

const requestPhysicalInput = type({
  assetId: "string >= 1",
  quantity: "number >= 1",
  store: "string >= 1",
  shipStreet: "string >= 1",
  shipCity: "string >= 1",
  shipProvince: "string >= 1",
  shipPostal: "string >= 1",
  contactName: "string >= 1",
  contactPhone: "string >= 1",
  "note?": "string",
});

/**
 * Gated: open a physical-print request against a `physical_available` asset the
 * caller's brand owns. The ownership + availability check (`brand_id ===
 * activeOrgId AND physical_available = 1`) is the tenancy boundary — a forged /
 * foreign / download-only `assetId` resolves to "not_found", never another
 * brand's asset. The asset's `physical_max_qty` caps the request quantity (a
 * higher ask is clamped down to the cap). INSERTs a `physical_requests` row at
 * status "Requested" (shipping address is an inline one-shot snapshot) and emits
 * a `physical_request` event. brand = envelope `activeOrgId`, never input. The
 * requester is NOT notified on open — notifications are the brand's decisions.
 */
export const requestPhysical = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(requestPhysicalInput)
  .handler(async ({ data, context }): Promise<{ ok: true; requestId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    // Verify the asset is the caller's brand's AND offered as a physical print.
    const asset = (
      await db
        .select({ id: assets.id, physicalMaxQty: assets.physicalMaxQty })
        .from(assets)
        .where(
          and(
            eq(assets.id, data.assetId),
            eq(assets.brandId, brandId),
            eq(assets.physicalAvailable, 1),
            isNull(assets.archivedAt),
          ),
        )
        .limit(1)
    ).at(0);
    if (!asset) throw new Error("not_found");

    // Honour the per-request cap when one is set (clamp rather than reject).
    const quantity =
      asset.physicalMaxQty != null && asset.physicalMaxQty > 0
        ? Math.min(data.quantity, asset.physicalMaxQty)
        : data.quantity;

    const requestId = ulid();
    const now = Date.now();
    await db.insert(physicalRequests).values({
      id: requestId,
      brandId,
      assetId: data.assetId,
      userId,
      quantity,
      store: data.store.trim(),
      shipStreet: data.shipStreet.trim(),
      shipCity: data.shipCity.trim(),
      shipProvince: data.shipProvince.trim(),
      shipPostal: data.shipPostal.trim(),
      contactName: data.contactName.trim(),
      contactPhone: data.contactPhone.trim(),
      note: nullableTrim(data.note),
      status: "Requested",
      createdAt: now,
      updatedAt: now,
    });

    await emitEvent({
      brandId,
      actorId: userId,
      type: "physical_request",
      targetType: "asset",
      targetId: data.assetId,
      metadata: { requestId, quantity },
    });

    return { ok: true, requestId };
  });

/**
 * Gated: the caller's OWN physical-print requests for their brand, newest-first —
 * the "My Requests" status view the `fulfilment_status` notification deep-links
 * into. Scoped to `user_id = caller AND brand_id = activeOrgId`, so it can never
 * surface another budtender's or another brand's request. No active org → empty.
 */
export const listMyRequests = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<MyRequestView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const rows = await db
      .select(REQUEST_COLS)
      .from(physicalRequests)
      .innerJoin(assets, eq(assets.id, physicalRequests.assetId))
      .where(and(eq(physicalRequests.brandId, brandId), eq(physicalRequests.userId, userId)))
      .orderBy(desc(physicalRequests.createdAt), desc(physicalRequests.id));

    return rows.map(mapMyRequest);
  });

// ─── admin paths (brand-role gated, in-handler decideBrandAdmin) ────────────

const fulfilmentQueueInput = type({
  "status?": "'Requested' | 'Approved' | 'Shipped' | 'Deployed' | 'Declined'",
});

/**
 * Admin: the brand's fulfilment queue, newest-first, optionally filtered to one
 * status (default: all). brand = envelope `activeOrgId`, never input. Brand-role
 * gated so a plain budtender can't enumerate the brand's requests. Each row
 * carries the full shipping snapshot + requester for the operator to action.
 */
export const listFulfilmentQueue = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(fulfilmentQueueInput)
  .handler(async ({ data, context }): Promise<FulfilmentRequestView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const where = data.status
      ? and(eq(physicalRequests.brandId, brandId), eq(physicalRequests.status, data.status))
      : eq(physicalRequests.brandId, brandId);
    const rows = await db
      .select(REQUEST_COLS)
      .from(physicalRequests)
      .innerJoin(assets, eq(assets.id, physicalRequests.assetId))
      .where(where)
      .orderBy(desc(physicalRequests.createdAt), desc(physicalRequests.id));

    // Resolve the proof-of-display photo for any deployed rows that carry one
    // (so the LP sees the proof). Bounded by the rows that actually have a proof.
    const roadie = getRoadie();
    return Promise.all(
      rows.map(async (row): Promise<FulfilmentRequestView> => {
        const view = mapFulfilment(row);
        if (row.proofPhotoRef && !row.proofPhotoRef.startsWith("pending:")) {
          try {
            const res = await roadie.getReadUrl({
              referenceId: row.proofPhotoRef,
              disposition: "inline",
              permissionScope: `brand:${brandId}`,
            });
            if (res.ok) view.proofPhotoUrl = res.value.url;
          } catch {
            view.proofPhotoUrl = null; // roadie inert / failed — show the badge, no image
          }
        }
        return view;
      }),
    );
  });

const decideFulfilmentInput = type({
  requestId: "string >= 1",
  status: "'Approved' | 'Shipped' | 'Declined'",
  "tracking?": "string",
  "reason?": "string",
});

/** The notification title + body the requester sees for each terminal decision. */
function notifyCopyFor(
  status: "Approved" | "Shipped" | "Declined",
  assetName: string,
  tracking: string | null,
  reason: string | null,
): { title: string; body: string } {
  switch (status) {
    case "Approved":
      return {
        title: "Print request approved",
        body: `Your request for “${assetName}” was approved and is being prepared.`,
      };
    case "Shipped":
      return {
        title: "Print request shipped",
        body: tracking
          ? `Your request for “${assetName}” shipped. Tracking: ${tracking}.`
          : `Your request for “${assetName}” has shipped.`,
      };
    case "Declined":
      return {
        title: "Print request declined",
        body: reason
          ? `Your request for “${assetName}” was declined: ${reason}`
          : `Your request for “${assetName}” was declined.`,
      };
  }
}

/**
 * Admin: advance one fulfilment request to Approved / Shipped (optional tracking)
 * / Declined (optional reason). brand = envelope `activeOrgId`; the UPDATE's
 * `brand_id` guard makes a cross-brand decision a no-op → 404. Stamps the new
 * status (+ tracking / decline_reason), `writeAudit`s the transition, then
 * `emitNotification`s the requester via the IN-PLATFORM channel (`type:
 * "fulfilment_status"`, ref → the request, so the bell deep-links to /requests).
 * Brand-Admin gated; audited; the email mirror via promoter is deferred.
 */
export const decideFulfilment = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(decideFulfilmentInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    // Load the request (scoped to the brand) for the requester + asset name the
    // notification needs. A forged/foreign requestId resolves to not_found.
    const request = (
      await db
        .select({
          id: physicalRequests.id,
          userId: physicalRequests.userId,
          assetName: assets.name,
        })
        .from(physicalRequests)
        .innerJoin(assets, eq(assets.id, physicalRequests.assetId))
        .where(and(eq(physicalRequests.id, data.requestId), eq(physicalRequests.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!request) throw new Error("not_found");

    const tracking = data.status === "Shipped" ? nullableTrim(data.tracking) : null;
    const reason = data.status === "Declined" ? nullableTrim(data.reason) : null;

    const updated = await db
      .update(physicalRequests)
      .set({ status: data.status, tracking, declineReason: reason, updatedAt: Date.now() })
      .where(and(eq(physicalRequests.id, data.requestId), eq(physicalRequests.brandId, brandId)))
      .returning({ id: physicalRequests.id });
    if (updated.length === 0) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "fulfilment.decide",
      actorId: userId,
      targetType: "physical_request",
      targetId: data.requestId,
      meta: { status: data.status, tracking, reason },
    });

    const copy = notifyCopyFor(data.status, request.assetName, tracking, reason);
    await emitNotification({
      brandId,
      userId: request.userId,
      type: "fulfilment_status",
      title: copy.title,
      body: copy.body,
      refType: "physical_request",
      refId: data.requestId,
    });

    return { ok: true };
  });

// ─── proof-of-display (budtender confirms the display went up in-store) ─────

const registerProofInput = type({
  requestId: "string >= 1",
  hash: /^[a-f0-9]{64}$/,
  size: "number >= 0",
  contentType: "string >= 1",
});

export interface RegisterProofResult {
  /** Reference handle to thread back into `confirmDeployed`. */
  referenceId: string;
  /** Presigned PUT envelope for the browser, or null when roadie is inert. */
  upload: { url: string; headers: Record<string, string> } | null;
}

/**
 * Gated: register an in-store proof photo for one of the CALLER'S OWN shipped
 * requests. The request must be the caller's (user_id === envelope actor) and in
 * a confirmable state (Shipped or Approved). Registers the blob with roadie and
 * returns the presigned PUT envelope; when roadie is inert (local dev) the
 * `upload` is null and the caller can still `confirmDeployed` without a photo.
 */
export const registerDisplayProof = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(registerProofInput)
  .handler(async ({ data, context }): Promise<RegisterProofResult> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const request = (
      await db
        .select({ id: physicalRequests.id, status: physicalRequests.status })
        .from(physicalRequests)
        .where(
          and(
            eq(physicalRequests.id, data.requestId),
            eq(physicalRequests.brandId, brandId),
            eq(physicalRequests.userId, userId), // only the requester confirms
          ),
        )
        .limit(1)
    ).at(0);
    if (!request) throw new Error("not_found");
    if (request.status !== "Shipped" && request.status !== "Approved") {
      throw new Error("not_confirmable");
    }

    let referenceId = `pending:${data.requestId}`;
    let upload: RegisterProofResult["upload"] = null;
    try {
      const res = await getRoadie().registerUpload({
        hash: data.hash,
        size: data.size,
        contentType: data.contentType,
        application: { app: "sprout", resourceType: "display-proof", resourceId: data.requestId },
      });
      if (res.ok) {
        referenceId = res.value.referenceId;
        if (res.value.status === "single-part") {
          upload = { url: res.value.upload.uploadUrl, headers: res.value.upload.requiredHeaders };
        }
      }
    } catch {
      referenceId = `pending:${data.requestId}`; // roadie inert — caller proceeds photo-less
      upload = null;
    }

    return { referenceId, upload };
  });

const confirmDeployedInput = type({
  requestId: "string >= 1",
  "referenceId?": "string",
});

/**
 * Gated: the budtender confirms the display is UP in-store (proof-of-display) for
 * one of their OWN shipped requests — the "show LPs their display got put up" win.
 * Flips status Shipped/Approved → Deployed, stamps `deployed_at` + the optional
 * `proof_photo_ref` (best-effort roadie finalize), and notifies the original
 * requester's brand via the in-platform channel. The LP sees the proof on the
 * fulfilment queue. Requester-gated (never an admin path); audited. NOTE: there is
 * deliberately NO points/prizing tied to this — that would violate INV-1 (no
 * inducements); the value here is proof + visibility, not a reward.
 */
export const confirmDeployed = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(confirmDeployedInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;

    const db = createDb(env.DB);
    const request = (
      await db
        .select({
          id: physicalRequests.id,
          status: physicalRequests.status,
          assetName: assets.name,
        })
        .from(physicalRequests)
        .innerJoin(assets, eq(assets.id, physicalRequests.assetId))
        .where(
          and(
            eq(physicalRequests.id, data.requestId),
            eq(physicalRequests.brandId, brandId),
            eq(physicalRequests.userId, userId),
          ),
        )
        .limit(1)
    ).at(0);
    if (!request) throw new Error("not_found");
    if (request.status !== "Shipped" && request.status !== "Approved") {
      throw new Error("not_confirmable");
    }

    // Best-effort finalize of the proof blob (no-op / failure when roadie inert).
    let proofPhotoRef: string | null = null;
    if (data.referenceId && !data.referenceId.startsWith("pending:")) {
      try {
        const res = await getRoadie().finalize({ referenceId: data.referenceId });
        if (res.ok) proofPhotoRef = data.referenceId;
      } catch {
        proofPhotoRef = null; // couldn't finalize — record the deployment, drop the photo
      }
    }

    const now = Date.now();
    await db
      .update(physicalRequests)
      .set({ status: "Deployed", deployedAt: now, proofPhotoRef, updatedAt: now })
      .where(and(eq(physicalRequests.id, data.requestId), eq(physicalRequests.brandId, brandId)));

    await writeAudit({
      brandId,
      action: "request.deployed",
      actorId: userId,
      targetType: "physical_request",
      targetId: data.requestId,
      meta: { hasPhoto: proofPhotoRef != null },
    });

    return { ok: true };
  });
