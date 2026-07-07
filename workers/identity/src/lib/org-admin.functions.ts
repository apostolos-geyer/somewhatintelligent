import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";
import { requireAdminMiddleware } from "@/lib/middleware/auth";

// ------------------------------------------------------------------
// Shapes returned to the client. We narrow the loose Eden responses
// (which include `unknown`-typed nested fields from the Drizzle row
// shape) into typed payloads the routes can rely on.
// ------------------------------------------------------------------

export interface OrgRow {
  id: string;
  slug: string;
  name: string;
  logo: string | null;
  createdAt: string | number | Date | null;
  memberCount: number;
  ownerName: string | null;
}

export interface OrgMember {
  memberId: string;
  userId: string;
  name: string | null;
  email: string | null;
  image: string | null;
  role: string;
  joinedAt: string | number | Date | null;
}

export interface OrgInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string | number | Date | null;
  inviterName: string | null;
}

export interface OrgDetailPayload {
  organization: {
    id: string;
    slug: string;
    name: string;
    logo: string | null;
    createdAt: string | number | Date | null;
    metadata: string | null;
  };
  members: OrgMember[];
  invitations: OrgInvitation[];
}

export interface UserSearchHit {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

type OrgRole = "owner" | "admin" | "member";

// ------------------------------------------------------------------
// Server functions — each one wraps a single guestlist operator route.
// Cookies flow through the kit factory automatically; the admin gate
// runs in middleware before the handler.
// ------------------------------------------------------------------

export const listOrgsForAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async (): Promise<{ orgs: OrgRow[] }> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.orgs.get();
    if (res.error) throw new Error(JSON.stringify(res.error.value));
    return { orgs: (res.data?.organizations ?? []) as OrgRow[] };
  });

export const searchUsersByEmail = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { email: string }) => data)
  .handler(async ({ data }): Promise<{ users: UserSearchHit[] }> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.users.search.get({ query: { email: data.email } });
    if (res.error) throw new Error(JSON.stringify(res.error.value));
    return { users: (res.data?.users ?? []) as UserSearchHit[] };
  });

export const getOrgForAdmin = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orgId: string }) => data)
  .handler(async ({ data }): Promise<OrgDetailPayload> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.orgs({ id: data.orgId }).get();
    if (res.error) {
      const body = res.error.value as { error?: string } | null;
      if (body?.error === "not_found") throw notFound();
      throw new Error(JSON.stringify(res.error.value));
    }
    const raw = res.data;
    if (!raw) throw notFound();
    return {
      organization: raw.organization as OrgDetailPayload["organization"],
      members: (raw.members ?? []) as OrgMember[],
      invitations: (raw.invitations ?? []) as OrgInvitation[],
    };
  });

export const createOrgAsOperator = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { name: string; slug: string; ownerUserId: string }) => data)
  .handler(
    async ({
      data,
    }): Promise<
      | { ok: true; organization: { id: string; slug: string; name: string } }
      | { ok: false; error: "slug_taken" | "unknown"; message: string }
    > => {
      const guestlist = getGuestlist();
      const res = await guestlist.api.admin.orgs.create.post({
        name: data.name,
        slug: data.slug,
        ownerUserId: data.ownerUserId,
      });
      if (res.error) {
        const body = res.error.value as { error?: string; message?: string } | null;
        if (body?.error === "slug_taken") {
          return { ok: false, error: "slug_taken", message: body.message ?? "Slug already taken" };
        }
        return {
          ok: false,
          error: "unknown",
          message: body?.message ?? JSON.stringify(res.error.value),
        };
      }
      const org = res.data?.organization as { id: string; slug: string; name: string } | undefined;
      if (!org) {
        return { ok: false, error: "unknown", message: "No org returned from server" };
      }
      return { ok: true, organization: org };
    },
  );

export const addOrgMember = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orgId: string; userId: string; role: OrgRole }) => data)
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.orgs({ id: data.orgId }).members.post({
      userId: data.userId,
      role: data.role,
    });
    if (res.error) {
      const body = res.error.value as { error?: string; message?: string } | null;
      if (body?.error === "already_member") {
        throw new Error("This user is already a member of this org.");
      }
      if (body?.error === "not_found") {
        throw new Error("User not found.");
      }
      throw new Error(body?.message ?? JSON.stringify(res.error.value));
    }
    return { success: true as const };
  });

export const updateOrgMemberRole = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orgId: string; userId: string; role: OrgRole }) => data)
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin
      .orgs({ id: data.orgId })
      .members({ userId: data.userId })
      ["update-role"].post({ role: data.role });
    if (res.error) {
      const body = res.error.value as { error?: string } | null;
      if (body?.error === "cannot_demote_last_owner") {
        throw new Error("Cannot demote the only owner of this org.");
      }
      if (body?.error === "member_not_found") {
        throw new Error("Member not found.");
      }
      throw new Error(JSON.stringify(res.error.value));
    }
    return { success: true as const };
  });

export const removeOrgMember = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orgId: string; userId: string }) => data)
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin
      .orgs({ id: data.orgId })
      .members({ userId: data.userId })
      .remove.post();
    if (res.error) {
      const body = res.error.value as { error?: string } | null;
      if (body?.error === "cannot_remove_last_owner") {
        throw new Error("Cannot remove the only owner of this org.");
      }
      if (body?.error === "member_not_found") {
        throw new Error("Member not found.");
      }
      throw new Error(JSON.stringify(res.error.value));
    }
    return { success: true as const };
  });

export const createOrgInvitation = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orgId: string; email: string; role: OrgRole }) => data)
  .handler(async ({ data }): Promise<{ invitationId: string }> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.orgs({ id: data.orgId }).invitations.post({
      email: data.email,
      role: data.role,
    });
    if (res.error) {
      const body = res.error.value as { error?: string; message?: string } | null;
      throw new Error(body?.message ?? JSON.stringify(res.error.value));
    }
    const inv = res.data?.invitation as { id: string } | undefined;
    if (!inv) throw new Error("No invitation returned from server");
    return { invitationId: inv.id };
  });

export const cancelOrgInvitation = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { orgId: string; invitationId: string }) => data)
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin
      .orgs({ id: data.orgId })
      .invitations({ invitationId: data.invitationId })
      .cancel.post();
    if (res.error) {
      const body = res.error.value as { error?: string } | null;
      throw new Error(body?.error ?? JSON.stringify(res.error.value));
    }
    return { success: true as const };
  });
