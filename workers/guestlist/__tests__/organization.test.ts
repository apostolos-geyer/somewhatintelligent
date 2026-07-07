import { env, SELF } from "cloudflare:test";
import {
  signUpAdmin,
  signUpVerified,
  uniqueEmail,
  GUESTLIST_DEV_ORIGIN,
  TEST_EMAIL_DOMAIN,
} from "./helpers";

describe("Organization plugin + operator create route", () => {
  test("BA org plugin is mounted (checkSlug works)", async () => {
    const { cookies } = await signUpVerified({
      name: "Slug Checker",
      email: uniqueEmail("slug-check"),
      password: "Slug1234!",
    });
    const res = await SELF.fetch("http://localhost/api/auth/organization/check-slug", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: GUESTLIST_DEV_ORIGIN,
        Cookie: cookies,
      },
      body: JSON.stringify({ slug: "totally-free-slug-xyz" }),
    });
    expect(res.status).toBe(200);
  });

  test(
    "admin can create org for another user via POST /admin/orgs/create",
    { timeout: 30_000 },
    async () => {
      // Set up a target user (will be owner) and an admin (will create)
      const targetEmail = uniqueEmail("owner");
      const target = await signUpVerified({
        name: "Org Owner",
        email: targetEmail,
        password: "Owner1234!",
      });
      const adminUser = await signUpAdmin({
        name: "Platform Admin",
        email: uniqueEmail("admin"),
        password: "Admin1234!",
      });

      const slug = `acme-${Date.now()}`;
      const res = await SELF.fetch("http://localhost/admin/orgs/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: GUESTLIST_DEV_ORIGIN,
          Cookie: adminUser.cookies,
        },
        body: JSON.stringify({
          name: "Acme Cannabis",
          slug,
          ownerUserId: target.userId,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        organization: { id: string; slug: string };
      };
      expect(body.organization.slug).toBe(slug);

      // Confirm the member row was created with role=owner for the target user
      const memberRow = await env.DB.prepare(
        "SELECT role FROM member WHERE user_id = ? AND organization_id = ?",
      )
        .bind(target.userId, body.organization.id)
        .first<{ role: string }>();
      expect(memberRow?.role).toBe("owner");
    },
  );

  test("non-admin gets 403 on POST /admin/orgs/create", async () => {
    const regularUser = await signUpVerified({
      name: "Regular User",
      email: uniqueEmail("regular"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch("http://localhost/admin/orgs/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: GUESTLIST_DEV_ORIGIN,
        Cookie: regularUser.cookies,
      },
      body: JSON.stringify({
        name: "Should Fail",
        slug: `fail-${Date.now()}`,
        ownerUserId: regularUser.userId,
      }),
    });
    expect(res.status).toBe(403);
  });
});

// Shared helpers for the O-3..O-7 operator-route describe blocks. Each call
// stands up an admin + a target user + an org owned by that target, since
// most operator routes need an existing org to exercise. Encapsulates the
// 3-roundtrip dance so individual tests stay readable.
async function setupOrgScenario(opts: {
  ownerName: string;
  ownerPassword?: string;
  orgSlug?: string;
  orgName?: string;
}): Promise<{
  admin: { cookies: string; userId: string };
  owner: { cookies: string; userId: string };
  orgId: string;
  orgSlug: string;
}> {
  const admin = await signUpAdmin({
    name: "Op Admin",
    email: uniqueEmail("op-admin"),
    password: "Admin1234!",
  });
  const owner = await signUpVerified({
    name: opts.ownerName,
    email: uniqueEmail("owner"),
    password: opts.ownerPassword ?? "Owner1234!",
  });
  const slug = opts.orgSlug ?? `org-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const res = await SELF.fetch("http://localhost/admin/orgs/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: GUESTLIST_DEV_ORIGIN,
      Cookie: admin.cookies,
    },
    body: JSON.stringify({
      name: opts.orgName ?? "Acme",
      slug,
      ownerUserId: owner.userId,
    }),
  });
  if (res.status !== 200) {
    throw new Error(`setupOrgScenario: create-org returned ${res.status}: ${await res.text()}`);
  }
  const body = (await res.json()) as { organization: { id: string; slug: string } };
  return { admin, owner, orgId: body.organization.id, orgSlug: body.organization.slug };
}

const ORIGIN = GUESTLIST_DEV_ORIGIN;

describe("GET /admin/orgs", () => {
  test(
    "lists all orgs across the platform with member counts and ownerName, sorted by createdAt desc",
    { timeout: 30_000 },
    async () => {
      const admin = await signUpAdmin({
        name: "List Admin",
        email: uniqueEmail("list-admin"),
        password: "Admin1234!",
      });
      const owner1 = await signUpVerified({
        name: "Alpha Owner",
        email: uniqueEmail("alpha"),
        password: "Alpha1234!",
      });
      const owner2 = await signUpVerified({
        name: "Beta Owner",
        email: uniqueEmail("beta"),
        password: "Beta1234!",
      });
      // Create two orgs back-to-back so the second has the larger createdAt.
      const slug1 = `alpha-${Date.now()}`;
      const r1 = await SELF.fetch("http://localhost/admin/orgs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
        body: JSON.stringify({ name: "Alpha", slug: slug1, ownerUserId: owner1.userId }),
      });
      expect(r1.status).toBe(200);
      // Sleep 5ms so timestamps differ deterministically.
      await new Promise((r) => setTimeout(r, 5));
      const slug2 = `beta-${Date.now()}`;
      const r2 = await SELF.fetch("http://localhost/admin/orgs/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
        body: JSON.stringify({ name: "Beta", slug: slug2, ownerUserId: owner2.userId }),
      });
      expect(r2.status).toBe(200);

      const res = await SELF.fetch("http://localhost/admin/orgs", {
        headers: { Cookie: admin.cookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        organizations: Array<{
          id: string;
          slug: string;
          memberCount: number;
          ownerName: string | null;
        }>;
      };
      const bySlug = new Map(body.organizations.map((o) => [o.slug, o]));
      const a = bySlug.get(slug1)!;
      const b = bySlug.get(slug2)!;
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(a.memberCount).toBe(1);
      expect(b.memberCount).toBe(1);
      expect(a.ownerName).toBe("Alpha Owner");
      expect(b.ownerName).toBe("Beta Owner");
      // Beta was created after Alpha so it should sort first (createdAt desc).
      const idxA = body.organizations.findIndex((o) => o.slug === slug1);
      const idxB = body.organizations.findIndex((o) => o.slug === slug2);
      expect(idxB).toBeLessThan(idxA);
    },
  );

  test("non-admin gets 403", async () => {
    const regular = await signUpVerified({
      name: "Regular",
      email: uniqueEmail("regular-list"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch("http://localhost/admin/orgs", {
      headers: { Cookie: regular.cookies },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/users/search", () => {
  test("empty/short prefix returns empty users", { timeout: 30_000 }, async () => {
    const admin = await signUpAdmin({
      name: "Search Admin",
      email: uniqueEmail("search-admin"),
      password: "Admin1234!",
    });
    const r1 = await SELF.fetch("http://localhost/admin/users/search?email=", {
      headers: { Cookie: admin.cookies },
    });
    expect(r1.status).toBe(200);
    expect((await r1.json()) as { users: unknown[] }).toEqual({ users: [] });
    const r2 = await SELF.fetch("http://localhost/admin/users/search?email=a", {
      headers: { Cookie: admin.cookies },
    });
    expect(r2.status).toBe(200);
    expect((await r2.json()) as { users: unknown[] }).toEqual({ users: [] });
  });

  test("valid prefix returns matching users", { timeout: 30_000 }, async () => {
    const admin = await signUpAdmin({
      name: "Search Admin 2",
      email: uniqueEmail("search-admin-2"),
      password: "Admin1234!",
    });
    const prefix = `srch${Date.now()}`;
    const target = await signUpVerified({
      name: "Target User",
      email: `${prefix}@${TEST_EMAIL_DOMAIN}`,
      password: "Target1234!",
    });
    const res = await SELF.fetch(
      `http://localhost/admin/users/search?email=${encodeURIComponent(prefix)}`,
      { headers: { Cookie: admin.cookies } },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ id: string; email: string }> };
    expect(body.users.some((u) => u.id === target.userId)).toBe(true);
  });

  test("non-admin gets 403", async () => {
    const regular = await signUpVerified({
      name: "Regular Searcher",
      email: uniqueEmail("regular-search"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch("http://localhost/admin/users/search?email=a", {
      headers: { Cookie: regular.cookies },
    });
    expect(res.status).toBe(403);
  });
});

describe("GET /admin/orgs/:id", () => {
  test(
    "returns organization, members (sorted), and pending invitations",
    { timeout: 30_000 },
    async () => {
      const { admin, owner, orgId } = await setupOrgScenario({ ownerName: "Detail Owner" });
      // Insert a second member directly via the new add-member route to
      // exercise the sort. We add them as `member` (sorts after owner).
      const newbie = await signUpVerified({
        name: "Newbie",
        email: uniqueEmail("newbie"),
        password: "Newbie1234!",
      });
      const addRes = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
        body: JSON.stringify({ userId: newbie.userId, role: "member" }),
      });
      expect(addRes.status).toBe(200);
      // Add a pending invitation directly via the operator-invite route.
      const pendingEmail = `pending@${TEST_EMAIL_DOMAIN}`;
      const invRes = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
        body: JSON.stringify({ email: pendingEmail, role: "member" }),
      });
      expect(invRes.status).toBe(200);

      const res = await SELF.fetch(`http://localhost/admin/orgs/${orgId}`, {
        headers: { Cookie: admin.cookies },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        organization: { id: string };
        members: Array<{ userId: string; role: string; name: string | null }>;
        invitations: Array<{ email: string; status: string }>;
      };
      expect(body.organization.id).toBe(orgId);
      // Owner sorts before member.
      expect(body.members[0]?.userId).toBe(owner.userId);
      expect(body.members[0]?.role).toBe("owner");
      expect(body.members[1]?.userId).toBe(newbie.userId);
      expect(body.members[1]?.role).toBe("member");
      // The pending invitation appears.
      expect(body.invitations.some((i) => i.email === pendingEmail)).toBe(true);
    },
  );

  test("non-admin gets 403", { timeout: 30_000 }, async () => {
    const { orgId } = await setupOrgScenario({ ownerName: "Lonely" });
    const regular = await signUpVerified({
      name: "Regular Detail",
      email: uniqueEmail("regular-detail"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch(`http://localhost/admin/orgs/${orgId}`, {
      headers: { Cookie: regular.cookies },
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/orgs/:id/members", () => {
  test("admin can add a member; persisted in D1", { timeout: 30_000 }, async () => {
    const { admin, orgId } = await setupOrgScenario({ ownerName: "Owner of Adders" });
    const target = await signUpVerified({
      name: "To Be Added",
      email: uniqueEmail("addee"),
      password: "Addee1234!",
    });
    const res = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      body: JSON.stringify({ userId: target.userId, role: "admin" }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT role FROM member WHERE user_id = ? AND organization_id = ?",
    )
      .bind(target.userId, orgId)
      .first<{ role: string }>();
    expect(row?.role).toBe("admin");
  });

  test("non-admin gets 403", { timeout: 30_000 }, async () => {
    const { orgId } = await setupOrgScenario({ ownerName: "Adder Owner" });
    const regular = await signUpVerified({
      name: "Regular Adder",
      email: uniqueEmail("regular-adder"),
      password: "Regular1234!",
    });
    const target = await signUpVerified({
      name: "Will Not Be Added",
      email: uniqueEmail("never"),
      password: "Never1234!",
    });
    const res = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: regular.cookies },
      body: JSON.stringify({ userId: target.userId, role: "member" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/orgs/:id/members/:userId/update-role", () => {
  test("admin can update a member's role; persisted in D1", { timeout: 30_000 }, async () => {
    const { admin, orgId } = await setupOrgScenario({ ownerName: "Role Org Owner" });
    const target = await signUpVerified({
      name: "Promote Me",
      email: uniqueEmail("promote"),
      password: "Promote1234!",
    });
    // Add as member, then promote to admin.
    const addRes = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      body: JSON.stringify({ userId: target.userId, role: "member" }),
    });
    expect(addRes.status).toBe(200);
    const upRes = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/members/${target.userId}/update-role`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(upRes.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT role FROM member WHERE user_id = ? AND organization_id = ?",
    )
      .bind(target.userId, orgId)
      .first<{ role: string }>();
    expect(row?.role).toBe("admin");
  });

  test("returns 400 when demoting the last owner", { timeout: 30_000 }, async () => {
    const { admin, owner, orgId } = await setupOrgScenario({
      ownerName: "Last Standing Owner",
    });
    const res = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/members/${owner.userId}/update-role`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
        body: JSON.stringify({ role: "member" }),
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("cannot_demote_last_owner");
    // Confirm DB is unchanged.
    const row = await env.DB.prepare(
      "SELECT role FROM member WHERE user_id = ? AND organization_id = ?",
    )
      .bind(owner.userId, orgId)
      .first<{ role: string }>();
    expect(row?.role).toBe("owner");
  });

  test("non-admin gets 403", { timeout: 30_000 }, async () => {
    const { owner, orgId } = await setupOrgScenario({ ownerName: "Some Owner" });
    const regular = await signUpVerified({
      name: "Regular Promoter",
      email: uniqueEmail("regular-promoter"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/members/${owner.userId}/update-role`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: regular.cookies },
        body: JSON.stringify({ role: "admin" }),
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/orgs/:id/members/:userId/remove", () => {
  test("admin can remove a member; removed from D1", { timeout: 30_000 }, async () => {
    const { admin, orgId } = await setupOrgScenario({ ownerName: "Remover Org Owner" });
    const target = await signUpVerified({
      name: "Remove Me",
      email: uniqueEmail("remove"),
      password: "Remove1234!",
    });
    const addRes = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      body: JSON.stringify({ userId: target.userId, role: "member" }),
    });
    expect(addRes.status).toBe(200);
    const rmRes = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/members/${target.userId}/remove`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      },
    );
    expect(rmRes.status).toBe(200);
    const row = await env.DB.prepare(
      "SELECT role FROM member WHERE user_id = ? AND organization_id = ?",
    )
      .bind(target.userId, orgId)
      .first<{ role: string }>();
    expect(row).toBeNull();
  });

  test("returns 400 when removing the last owner", { timeout: 30_000 }, async () => {
    const { admin, owner, orgId } = await setupOrgScenario({
      ownerName: "Indispensable Owner",
    });
    const res = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/members/${owner.userId}/remove`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      },
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("cannot_remove_last_owner");
  });

  test("non-admin gets 403", { timeout: 30_000 }, async () => {
    const { owner, orgId } = await setupOrgScenario({ ownerName: "Owner B" });
    const regular = await signUpVerified({
      name: "Regular Remover",
      email: uniqueEmail("regular-remover"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/members/${owner.userId}/remove`,
      {
        method: "POST",
        headers: { Cookie: regular.cookies },
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/orgs/:id/invitations", () => {
  test("admin can issue a pending invitation; row exists in D1", { timeout: 30_000 }, async () => {
    const { admin, orgId } = await setupOrgScenario({ ownerName: "Inviter Owner" });
    const inviteEmail = `invitee-${Date.now()}@${TEST_EMAIL_DOMAIN}`;
    const res = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      body: JSON.stringify({ email: inviteEmail, role: "admin" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invitation: { id: string; status: string } };
    expect(body.invitation.status).toBe("pending");
    const row = await env.DB.prepare(
      "SELECT email, role, status, inviter_id FROM invitation WHERE id = ?",
    )
      .bind(body.invitation.id)
      .first<{ email: string; role: string; status: string; inviter_id: string }>();
    expect(row?.email).toBe(inviteEmail);
    expect(row?.role).toBe("admin");
    expect(row?.status).toBe("pending");
    expect(row?.inviter_id).toBe(admin.userId);
  });

  test("non-admin gets 403", { timeout: 30_000 }, async () => {
    const { orgId } = await setupOrgScenario({ ownerName: "Invite Owner" });
    const regular = await signUpVerified({
      name: "Regular Inviter",
      email: uniqueEmail("regular-inviter"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: regular.cookies },
      body: JSON.stringify({ email: `x@${TEST_EMAIL_DOMAIN}`, role: "member" }),
    });
    expect(res.status).toBe(403);
  });
});

describe("POST /admin/orgs/:id/invitations/:invitationId/cancel", () => {
  test(
    "admin can cancel a pending invitation; status becomes cancelled in D1",
    { timeout: 30_000 },
    async () => {
      const { admin, orgId } = await setupOrgScenario({ ownerName: "Canceller Owner" });
      const inviteRes = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
        body: JSON.stringify({
          email: `cancelme-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
          role: "member",
        }),
      });
      expect(inviteRes.status).toBe(200);
      const inviteBody = (await inviteRes.json()) as { invitation: { id: string } };
      const invitationId = inviteBody.invitation.id;
      const cancelRes = await SELF.fetch(
        `http://localhost/admin/orgs/${orgId}/invitations/${invitationId}/cancel`,
        {
          method: "POST",
          headers: { Cookie: admin.cookies },
        },
      );
      expect(cancelRes.status).toBe(200);
      const row = await env.DB.prepare("SELECT status FROM invitation WHERE id = ?")
        .bind(invitationId)
        .first<{ status: string }>();
      expect(row?.status).toBe("cancelled");
    },
  );

  test("404 when invitation does not exist", { timeout: 30_000 }, async () => {
    const { admin, orgId } = await setupOrgScenario({ ownerName: "Missing Inv Owner" });
    const res = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/invitations/nonexistent-id/cancel`,
      {
        method: "POST",
        headers: { Cookie: admin.cookies },
      },
    );
    expect(res.status).toBe(404);
  });

  test("409 when invitation is already cancelled", { timeout: 30_000 }, async () => {
    const { admin, orgId } = await setupOrgScenario({ ownerName: "Dup Cancel Owner" });
    const inviteRes = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      body: JSON.stringify({
        email: `dup-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        role: "member",
      }),
    });
    const inviteBody = (await inviteRes.json()) as { invitation: { id: string } };
    const id = inviteBody.invitation.id;
    const first = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/invitations/${id}/cancel`,
      { method: "POST", headers: { Cookie: admin.cookies } },
    );
    expect(first.status).toBe(200);
    const second = await SELF.fetch(
      `http://localhost/admin/orgs/${orgId}/invitations/${id}/cancel`,
      { method: "POST", headers: { Cookie: admin.cookies } },
    );
    expect(second.status).toBe(409);
  });

  test("non-admin gets 403", { timeout: 30_000 }, async () => {
    const { admin, orgId } = await setupOrgScenario({ ownerName: "Auth Cancel Owner" });
    const inviteRes = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, Cookie: admin.cookies },
      body: JSON.stringify({
        email: `auth-${Date.now()}@${TEST_EMAIL_DOMAIN}`,
        role: "member",
      }),
    });
    const inviteBody = (await inviteRes.json()) as { invitation: { id: string } };
    const id = inviteBody.invitation.id;
    const regular = await signUpVerified({
      name: "Regular Canceller",
      email: uniqueEmail("regular-canceller"),
      password: "Regular1234!",
    });
    const res = await SELF.fetch(`http://localhost/admin/orgs/${orgId}/invitations/${id}/cancel`, {
      method: "POST",
      headers: { Cookie: regular.cookies },
    });
    expect(res.status).toBe(403);
  });
});
