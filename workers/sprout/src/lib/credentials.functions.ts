/**
 * CanSell credential server functions — the "verify with a valid CanSell" login
 * concern (Idea 1). PLATFORM-WIDE per user (a person's retail cert, not per-brand):
 * the budtender paths key on the verified envelope's `actor.id`, NEVER
 * `activeOrgId` or input. The flow is UPLOAD → ADMIN REVIEW:
 *
 *  - The budtender UPLOADS their CanSell certificate (PDF/photo) as a roadie blob
 *    (the upload IS the proof), plus an optional cert number + a required expiry.
 *    `getMyCredential` reads their OWN cert + derived state + a resolved proof URL;
 *    `registerCredentialUpload` mints the presigned PUT (degrades when roadie is
 *    inert); `submitCredential` UPSERTs the row to `pending` and best-effort
 *    finalizes the blob. All scoped to `actor.id`.
 *  - A PLATFORM admin reviews each submission. `listPendingCredentials` is the
 *    review queue (every user's pending cert, with a resolved submitter name +
 *    proof URL); `reviewCredential` marks one `verified` / `rejected` and stamps
 *    `verified_by` + an optional note. Both gate with `requireAdminMiddleware`
 *    (god-mode — the cert is platform-wide, NOT per tenant).
 *
 * The derived state lives in the pure `@/lib/credentials` so the gate logic can't
 * drift from the UI. Enforcement is a SOFT PROMPT on the Hub — there is no portal
 * middleware gate here.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, eq } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { budtenderCredentials } from "@/schema";
import { requireUserMiddleware, requireAdminMiddleware } from "@/lib/middleware/auth";
import { getRoadie } from "@/lib/roadie";
import { getGuestlist } from "@/lib/guestlist";
import { writeAudit } from "@/lib/audit";
import { credentialState, type CredentialState } from "@/lib/credentials";

const KIND = "cansell";

/** The caller's CanSell certification + its derived usability. */
export interface MyCredential {
  issuer: string;
  credentialNumber: string | null;
  expiresAt: number;
  status: string;
  /** Optional admin note — the reject reason (or any verify comment). */
  reviewNote: string | null;
  /** True once a proof blob is on file (finalized, not a `pending:` placeholder). */
  hasProof: boolean;
  /** Resolved short-lived read URL for the uploaded certificate, or null. */
  proofUrl: string | null;
  /** Derived at read time (missing|pending|rejected|expired|valid). */
  state: CredentialState;
}

/** Resolve a short-lived inline read URL for a finalized proof blob, or null. */
async function resolveProofUrl(proofRef: string | null, userId: string): Promise<string | null> {
  if (!proofRef || proofRef.startsWith("pending:")) return null;
  try {
    const res = await getRoadie().getReadUrl({
      referenceId: proofRef,
      disposition: "inline",
      permissionScope: `user:${userId}`,
    });
    return res.ok ? res.value.url : null;
  } catch {
    return null; // roadie inert / failed — show the badge, no preview
  }
}

/**
 * Gated GET: the caller's OWN CanSell credential (or null). Scoped to the verified
 * envelope's `actor.id` — never another user, never an org. `state` is derived
 * server-side from the row + now, so the client renders the same verdict the soft
 * prompt uses; `proofUrl` is the resolved (or null, when roadie inert) certificate.
 */
export const getMyCredential = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<MyCredential | null> => {
    const userId = context.principal.actor.id;
    const db = createDb(env.DB);
    const row = (
      await db
        .select()
        .from(budtenderCredentials)
        .where(and(eq(budtenderCredentials.userId, userId), eq(budtenderCredentials.kind, KIND)))
        .limit(1)
    ).at(0);
    if (!row) return null;

    return {
      issuer: row.issuer,
      credentialNumber: row.credentialNumber,
      expiresAt: row.expiresAt,
      status: row.status,
      reviewNote: row.reviewNote,
      hasProof: !!row.proofRef && !row.proofRef.startsWith("pending:"),
      proofUrl: await resolveProofUrl(row.proofRef, userId),
      state: credentialState(row, Date.now()),
    };
  });

const registerUploadInput = type({
  hash: /^[a-f0-9]{64}$/,
  size: "number >= 0",
  contentType: "string >= 1",
});

export interface RegisterCredentialUploadResult {
  /** Reference handle to thread back into `submitCredential`. */
  referenceId: string;
  /** Presigned PUT envelope for the browser, or null when roadie is inert. */
  upload: { url: string; headers: Record<string, string> } | null;
}

/**
 * Gated: register the caller's CanSell certificate blob with roadie and return the
 * presigned PUT envelope for the browser to push the bytes. The blob is minted
 * under a per-USER permission scope (`user:${actor.id}`) — the cert is the
 * person's, not a brand's. When roadie is inert (local dev) the `upload` is null
 * and the caller still `submitCredential`s (recording the number/expiry without a
 * stored file). Mirrors `registerDisplayProof`.
 */
export const registerCredentialUpload = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .inputValidator(registerUploadInput)
  .handler(async ({ data, context }): Promise<RegisterCredentialUploadResult> => {
    const userId = context.principal.actor.id;

    let referenceId = `pending:${userId}`;
    let upload: RegisterCredentialUploadResult["upload"] = null;
    try {
      const res = await getRoadie().registerUpload({
        hash: data.hash,
        size: data.size,
        contentType: data.contentType,
        application: { app: "sprout", resourceType: "cansell-cert", resourceId: userId },
      });
      if (res.ok) {
        referenceId = res.value.referenceId;
        if (res.value.status === "single-part") {
          upload = { url: res.value.upload.uploadUrl, headers: res.value.upload.requiredHeaders };
        }
      }
    } catch {
      referenceId = `pending:${userId}`; // roadie inert — caller proceeds file-less
      upload = null;
    }

    return { referenceId, upload };
  });

const submitInput = type({
  "credentialNumber?": "string",
  expiresAt: "number > 0",
  "referenceId?": "string",
});

/**
 * Gated POST: submit/refresh the caller's CanSell certificate for ADMIN REVIEW.
 * UPSERT on (user_id, kind) → status `pending`, storing the (optional) cert
 * number, the required expiry, and the proof blob handle (best-effort roadie
 * finalize, like `confirmDeployed`; a `pending:`/failed ref is dropped). Clears
 * any prior `verified_by` + `review_note` so a re-submit re-enters the queue
 * cleanly. user_id is the envelope's, never input. Audited as a platform-wide
 * action (brand_id null).
 */
export const submitCredential = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .inputValidator(submitInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const userId = context.principal.actor.id;
    const now = Date.now();
    const credentialNumber = data.credentialNumber?.trim() ? data.credentialNumber.trim() : null;
    const db = createDb(env.DB);

    // Best-effort finalize of the cert blob (no-op / failure when roadie inert).
    let proofRef: string | null = null;
    if (data.referenceId && !data.referenceId.startsWith("pending:")) {
      try {
        const res = await getRoadie().finalize({ referenceId: data.referenceId });
        if (res.ok) proofRef = data.referenceId;
      } catch {
        proofRef = null; // couldn't finalize — record the submission, drop the file
      }
    }

    await db
      .insert(budtenderCredentials)
      .values({
        id: ulid(),
        userId,
        kind: KIND,
        issuer: "CanSell",
        credentialNumber,
        proofRef,
        expiresAt: data.expiresAt,
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [budtenderCredentials.userId, budtenderCredentials.kind],
        set: {
          credentialNumber,
          // Only replace the stored blob when a NEW file was finalized this
          // submit; an "Update CanSell" that only changes the expiry/number
          // leaves the file input empty (browsers can't pre-fill it), so without
          // this guard the existing certificate handle would be wiped to null.
          ...(proofRef != null ? { proofRef } : {}),
          expiresAt: data.expiresAt,
          status: "pending",
          reviewNote: null,
          verifiedBy: null,
          updatedAt: now,
        },
      });

    await writeAudit({
      brandId: null,
      action: "credential.submit",
      actorId: userId,
      targetType: "budtender_credential",
      targetId: userId,
      meta: { kind: KIND, hasProof: proofRef != null },
    });

    return { ok: true };
  });

// ─── platform-admin review queue (god-mode; requireAdminMiddleware) ─────────

/** One pending submission as the admin review queue renders it. */
export interface PendingCredential {
  userId: string;
  /** Resolved submitter display name (falls back to the user id). */
  submitterName: string;
  credentialNumber: string | null;
  expiresAt: number;
  /** True once a finalized proof blob is on file. */
  hasProof: boolean;
  /** Resolved short-lived read URL for the uploaded certificate, or null. */
  proofUrl: string | null;
  submittedAt: number;
}

/**
 * God-mode: every PENDING CanSell submission across all users — the review queue.
 * `requireAdminMiddleware` gated (platform admin only); INTENTIONALLY not
 * brand-scoped (the cert is platform-wide per person). Resolves each submitter's
 * display name (best-effort via guestlist) + a proof read URL. Oldest-first so
 * the queue is FIFO.
 */
export const listPendingCredentials = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async (): Promise<PendingCredential[]> => {
    const db = createDb(env.DB);
    const rows = await db
      .select({
        userId: budtenderCredentials.userId,
        credentialNumber: budtenderCredentials.credentialNumber,
        proofRef: budtenderCredentials.proofRef,
        expiresAt: budtenderCredentials.expiresAt,
        updatedAt: budtenderCredentials.updatedAt,
      })
      .from(budtenderCredentials)
      .where(and(eq(budtenderCredentials.kind, KIND), eq(budtenderCredentials.status, "pending")))
      .orderBy(asc(budtenderCredentials.updatedAt), asc(budtenderCredentials.userId));

    if (rows.length === 0) return [];

    // Resolve submitter display names by id (best-effort; degrade to the id).
    const nameById = new Map<string, string>();
    try {
      const users = await getGuestlist().getUsersByIds({ ids: rows.map((r) => r.userId) });
      for (const u of users) if (u.name) nameById.set(u.id, u.name);
    } catch {
      // user-directory lookup unavailable — names render as ids.
    }

    return Promise.all(
      rows.map(
        async (row): Promise<PendingCredential> => ({
          userId: row.userId,
          submitterName: nameById.get(row.userId) ?? row.userId,
          credentialNumber: row.credentialNumber,
          expiresAt: row.expiresAt,
          hasProof: !!row.proofRef && !row.proofRef.startsWith("pending:"),
          proofUrl: await resolveProofUrl(row.proofRef, row.userId),
          submittedAt: row.updatedAt,
        }),
      ),
    );
  });

const reviewInput = type({
  userId: "string >= 1",
  decision: "'verified' | 'rejected'",
  "note?": "string",
});

/**
 * God-mode: review one budtender's pending CanSell submission. `requireAdminMiddleware`
 * gated (platform admin only — the cert is platform-wide). Sets `status` to the
 * decision, stamps `verified_by` (the deciding admin) + the optional `review_note`
 * (the reject reason or a verify comment), and audits the decision (brand_id
 * null). A forged/unknown `userId` resolves to "not_found". No notification is
 * emitted: the `notifications` type enum has no credential-decision kind, and the
 * Hub soft-prompt surfaces the new state on next load — audit only here.
 */
export const reviewCredential = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator(reviewInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const adminId = context.principal.actor.id;
    const note = data.note?.trim() ? data.note.trim() : null;
    const now = Date.now();
    const db = createDb(env.DB);

    const updated = await db
      .update(budtenderCredentials)
      .set({
        status: data.decision,
        reviewNote: note,
        verifiedBy: adminId,
        updatedAt: now,
      })
      .where(
        and(
          eq(budtenderCredentials.userId, data.userId),
          eq(budtenderCredentials.kind, KIND),
          // Only a still-PENDING row is decidable — so a decision made against a
          // stale queue (the cert was re-submitted or already decided by another
          // admin in the meantime) no-ops to "not_found" instead of silently
          // clobbering the newer state.
          eq(budtenderCredentials.status, "pending"),
        ),
      )
      .returning({ id: budtenderCredentials.id });
    if (updated.length === 0) throw new Error("not_found");

    await writeAudit({
      brandId: null,
      action: "credential.review",
      actorId: adminId,
      targetType: "budtender_credential",
      targetId: data.userId,
      meta: { kind: KIND, decision: data.decision, hasNote: note != null },
    });

    return { ok: true };
  });
