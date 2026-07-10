/**
 * Donor's operator org-provisioning suite (653 lines of HTTP route tests),
 * ported to the admin RPC surface those routes became. Scenario coverage
 * is 1:1: create (+slug conflict), list (+counts/owner name), user search,
 * get (+member sort, pending invitations), member add/update-role/remove
 * (+last-owner guards, D1 persistence), invitations issue/cancel
 * (+state-machine errors), and non-admin gating on every method.
 */
import { env, SELF } from "cloudflare:test";
import { signUpAdmin, signUpVerified, uniqueEmail } from "./helpers";

let admin: { cookies: string; userId: string };
let user: { cookies: string; userId: string };

beforeAll(async () => {
  admin = await signUpAdmin({
    name: "Org Admin",
    email: uniqueEmail("orgadmin"),
    password: "Admin1234!@#$",
  });
  user = await signUpVerified({
    name: "Org Regular",
    email: uniqueEmail("orguser"),
    password: "User1234!@#$",
  });
});

let orgCounter = 0;
function slug(prefix: string): string {
  orgCounter += 1;
  return `${prefix}-${orgCounter}-${Date.now()}`;
}

async function createOrg(ownerUserId: string, name = "Test Org") {
  const res = await env.GL_RPC.adminCreateOrg({
    cookie: admin.cookies,
    name,
    slug: slug("org"),
    ownerUserId,
  });
  expect(res.ok).toBe(true);
  if (!res.ok) throw new Error(`createOrg failed: ${res.error}`);
  return (res.organization as { id: string }).id;
}

describe("BA org plugin mount", () => {
  test("checkSlug works over the BA HTTP surface", async () => {
    const res = await SELF.fetch("http://localhost/api/auth/organization/check-slug", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://guestlist.somewhatintelligent.ca",
        Cookie: admin.cookies,
      },
      body: JSON.stringify({ slug: slug("free") }),
    });
    expect(res.status).toBe(200);
  });
});

describe("adminCreateOrg", () => {
  test("creates an org owned by the named user; membership persisted", async () => {
    const orgId = await createOrg(user.userId, "Owned Elsewhere");
    const row = await env.DB.prepare(
      "SELECT role FROM member WHERE organization_id = ? AND user_id = ?",
    )
      .bind(orgId, user.userId)
      .first<{ role: string }>();
    expect(row?.role).toBe("owner");
  });

  test("slug collision reports slug_taken", async () => {
    const s = slug("dupe");
    const first = await env.GL_RPC.adminCreateOrg({
      cookie: admin.cookies,
      name: "First",
      slug: s,
      ownerUserId: user.userId,
    });
    expect(first.ok).toBe(true);
    const second = await env.GL_RPC.adminCreateOrg({
      cookie: admin.cookies,
      name: "Second",
      slug: s,
      ownerUserId: user.userId,
    });
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.error).toBe("slug_taken");
  });

  test("kebab-case slug is enforced", async () => {
    const res = await env.GL_RPC.adminCreateOrg({
      cookie: admin.cookies,
      name: "Bad Slug",
      slug: "Not A Slug!",
      ownerUserId: user.userId,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("validation");
  });

  test("non-admin is forbidden", async () => {
    const res = await env.GL_RPC.adminCreateOrg({
      cookie: user.cookies,
      name: "Nope",
      slug: slug("nope"),
      ownerUserId: user.userId,
    });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("adminListOrgs", () => {
  test("lists orgs with member counts and owner names", { timeout: 30_000 }, async () => {
    const orgId = await createOrg(user.userId, "Listed Org");
    const res = await env.GL_RPC.adminListOrgs({ cookie: admin.cookies });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    const found = res.organizations.find((o) => o.id === orgId);
    expect(found).toBeDefined();
    expect(found!.memberCount).toBe(1);
    expect(found!.ownerName).toBe("Org Regular");
  });

  test("non-admin is forbidden", async () => {
    const res = await env.GL_RPC.adminListOrgs({ cookie: user.cookies });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("adminSearchUsersByEmail", () => {
  test("empty/short prefix returns empty users", async () => {
    for (const email of ["", "a"]) {
      const res = await env.GL_RPC.adminSearchUsersByEmail({ cookie: admin.cookies, email });
      expect(res.ok).toBe(true);
      if (!res.ok) throw new Error("unreachable");
      expect(res.users).toEqual([]);
    }
  });

  test("valid prefix returns matching users", { timeout: 30_000 }, async () => {
    const marker = `pfx${Date.now()}`;
    const target = await signUpVerified({
      name: "Prefix Target",
      email: `${marker}@test.somewhatintelligent.ca`,
      password: "Target1234!",
    });
    const res = await env.GL_RPC.adminSearchUsersByEmail({
      cookie: admin.cookies,
      email: marker.slice(0, 6),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.users.some((u) => u.id === target.userId)).toBe(true);
  });

  test("non-admin is forbidden", async () => {
    const res = await env.GL_RPC.adminSearchUsersByEmail({ cookie: user.cookies, email: "xx" });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("adminGetOrg", () => {
  test("returns org, role-sorted members, pending invitations", { timeout: 30_000 }, async () => {
    const orgId = await createOrg(user.userId, "Detail Org");
    const extra = await signUpVerified({
      name: "Aaa Member",
      email: uniqueEmail("member"),
      password: "Member1234!",
    });
    const add = await env.GL_RPC.adminAddOrgMember({
      cookie: admin.cookies,
      orgId,
      userId: extra.userId,
      role: "member",
    });
    expect(add.ok).toBe(true);
    const inv = await env.GL_RPC.adminCreateOrgInvitation({
      cookie: admin.cookies,
      orgId,
      email: uniqueEmail("invite"),
      role: "member",
    });
    expect(inv.ok).toBe(true);

    const res = await env.GL_RPC.adminGetOrg({ cookie: admin.cookies, id: orgId });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    // Owner sorts before member despite alphabetical order favoring "Aaa".
    expect(res.members.map((m) => m.role)).toEqual(["owner", "member"]);
    expect(res.invitations.length).toBe(1);
    expect(res.invitations[0]!.status).toBe("pending");
  });

  test("not_found for a nonexistent org", async () => {
    const res = await env.GL_RPC.adminGetOrg({ cookie: admin.cookies, id: "does-not-exist" });
    expect(res).toEqual({ ok: false, error: "not_found" });
  });

  test("non-admin is forbidden", async () => {
    const res = await env.GL_RPC.adminGetOrg({ cookie: user.cookies, id: "whatever" });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("adminAddOrgMember", () => {
  test(
    "adds a member; persisted in D1; duplicate reports already_member",
    { timeout: 30_000 },
    async () => {
      const orgId = await createOrg(user.userId);
      const extra = await signUpVerified({
        name: "Added Member",
        email: uniqueEmail("added"),
        password: "Member1234!",
      });
      const res = await env.GL_RPC.adminAddOrgMember({
        cookie: admin.cookies,
        orgId,
        userId: extra.userId,
        role: "member",
      });
      expect(res.ok).toBe(true);
      const row = await env.DB.prepare(
        "SELECT role FROM member WHERE organization_id = ? AND user_id = ?",
      )
        .bind(orgId, extra.userId)
        .first<{ role: string }>();
      expect(row?.role).toBe("member");

      const dupe = await env.GL_RPC.adminAddOrgMember({
        cookie: admin.cookies,
        orgId,
        userId: extra.userId,
        role: "member",
      });
      expect(dupe.ok).toBe(false);
      if (dupe.ok) throw new Error("unreachable");
      expect(dupe.error).toBe("already_member");
    },
  );

  test("non-admin is forbidden", async () => {
    const res = await env.GL_RPC.adminAddOrgMember({
      cookie: user.cookies,
      orgId: "x",
      userId: "y",
      role: "member",
    });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("adminUpdateOrgMemberRole", () => {
  test("updates a role; persisted in D1", { timeout: 30_000 }, async () => {
    const orgId = await createOrg(user.userId);
    const extra = await signUpVerified({
      name: "Promotable",
      email: uniqueEmail("promote"),
      password: "Member1234!",
    });
    await env.GL_RPC.adminAddOrgMember({
      cookie: admin.cookies,
      orgId,
      userId: extra.userId,
      role: "member",
    });
    const res = await env.GL_RPC.adminUpdateOrgMemberRole({
      cookie: admin.cookies,
      orgId,
      userId: extra.userId,
      role: "admin",
    });
    expect(res.ok).toBe(true);
    const row = await env.DB.prepare(
      "SELECT role FROM member WHERE organization_id = ? AND user_id = ?",
    )
      .bind(orgId, extra.userId)
      .first<{ role: string }>();
    expect(row?.role).toBe("admin");
  });

  test("refuses to demote the last owner", { timeout: 30_000 }, async () => {
    const orgId = await createOrg(user.userId);
    const res = await env.GL_RPC.adminUpdateOrgMemberRole({
      cookie: admin.cookies,
      orgId,
      userId: user.userId,
      role: "member",
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("cannot_demote_last_owner");
  });

  test("non-admin is forbidden", async () => {
    const res = await env.GL_RPC.adminUpdateOrgMemberRole({
      cookie: user.cookies,
      orgId: "x",
      userId: "y",
      role: "member",
    });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("adminRemoveOrgMember", () => {
  test("removes a member; removed from D1", { timeout: 30_000 }, async () => {
    const orgId = await createOrg(user.userId);
    const extra = await signUpVerified({
      name: "Removable",
      email: uniqueEmail("remove"),
      password: "Member1234!",
    });
    await env.GL_RPC.adminAddOrgMember({
      cookie: admin.cookies,
      orgId,
      userId: extra.userId,
      role: "member",
    });
    const res = await env.GL_RPC.adminRemoveOrgMember({
      cookie: admin.cookies,
      orgId,
      userId: extra.userId,
    });
    expect(res.ok).toBe(true);
    const row = await env.DB.prepare(
      "SELECT id FROM member WHERE organization_id = ? AND user_id = ?",
    )
      .bind(orgId, extra.userId)
      .first();
    expect(row).toBeNull();
  });

  test("refuses to remove the last owner", { timeout: 30_000 }, async () => {
    const orgId = await createOrg(user.userId);
    const res = await env.GL_RPC.adminRemoveOrgMember({
      cookie: admin.cookies,
      orgId,
      userId: user.userId,
    });
    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("cannot_remove_last_owner");
  });

  test("non-admin is forbidden", async () => {
    const res = await env.GL_RPC.adminRemoveOrgMember({
      cookie: user.cookies,
      orgId: "x",
      userId: "y",
    });
    expect(res).toEqual({ ok: false, error: "forbidden" });
  });
});

describe("adminCreateOrgInvitation / adminCancelOrgInvitation", () => {
  test(
    "issues a pending invitation (row in D1), cancels it, refuses re-cancel",
    { timeout: 30_000 },
    async () => {
      const orgId = await createOrg(user.userId);
      const email = uniqueEmail("inv");
      const inv = await env.GL_RPC.adminCreateOrgInvitation({
        cookie: admin.cookies,
        orgId,
        email,
        role: "member",
      });
      expect(inv.ok).toBe(true);
      if (!inv.ok) throw new Error("unreachable");
      const row = await env.DB.prepare("SELECT status, inviter_id FROM invitation WHERE id = ?")
        .bind(inv.invitation.id)
        .first<{ status: string; inviter_id: string }>();
      expect(row?.status).toBe("pending");
      expect(row?.inviter_id).toBe(admin.userId);

      const cancel = await env.GL_RPC.adminCancelOrgInvitation({
        cookie: admin.cookies,
        orgId,
        invitationId: inv.invitation.id,
      });
      expect(cancel.ok).toBe(true);

      const again = await env.GL_RPC.adminCancelOrgInvitation({
        cookie: admin.cookies,
        orgId,
        invitationId: inv.invitation.id,
      });
      expect(again.ok).toBe(false);
      if (again.ok) throw new Error("unreachable");
      expect(again.error).toBe("invitation_not_pending");
    },
  );

  test("cancel of a nonexistent invitation reports invitation_not_found", async () => {
    const orgId = await createOrg(user.userId);
    const res = await env.GL_RPC.adminCancelOrgInvitation({
      cookie: admin.cookies,
      orgId,
      invitationId: "missing",
    });
    expect(res).toEqual({ ok: false, error: "invitation_not_found" });
  });

  test("non-admin is forbidden on both", async () => {
    const a = await env.GL_RPC.adminCreateOrgInvitation({
      cookie: user.cookies,
      orgId: "x",
      email: "x@y.com",
      role: "member",
    });
    expect(a).toEqual({ ok: false, error: "forbidden" });
    const b = await env.GL_RPC.adminCancelOrgInvitation({
      cookie: user.cookies,
      orgId: "x",
      invitationId: "y",
    });
    expect(b).toEqual({ ok: false, error: "forbidden" });
  });
});
