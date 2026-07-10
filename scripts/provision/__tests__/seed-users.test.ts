import { describe, expect, test } from "vite-plus/test";
import { buildSeedUsers, resolveAccessCredentials } from "../seed-users";

describe("buildSeedUsers", () => {
  test("is deterministic for the same count/prefix (idempotent payload)", () => {
    const a = buildSeedUsers(3, { prefix: "si-smoke" });
    const b = buildSeedUsers(3, { prefix: "si-smoke" });
    expect(a).toEqual(b);
  });

  test("first user is admin, the rest are user", () => {
    const users = buildSeedUsers(3);
    expect(users[0]!.role).toBe("admin");
    expect(users[1]!.role).toBe("user");
    expect(users[2]!.role).toBe("user");
  });

  test("emails are unique and use the given prefix/domain", () => {
    const users = buildSeedUsers(4, { prefix: "acme", domain: "test.example" });
    const emails = users.map((u) => u.email);
    expect(new Set(emails).size).toBe(4);
    for (const email of emails) expect(email.endsWith("@test.example")).toBe(true);
    expect(emails[0]).toBe("acme-1@test.example");
  });

  test("rejects a non-positive count", () => {
    expect(() => buildSeedUsers(0)).toThrow();
  });
});

describe("resolveAccessCredentials", () => {
  test("prefers explicit args over env", () => {
    const prevId = process.env.CF_ACCESS_CLIENT_ID;
    const prevSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    process.env.CF_ACCESS_CLIENT_ID = "env-id";
    process.env.CF_ACCESS_CLIENT_SECRET = "env-secret";
    try {
      const creds = resolveAccessCredentials({ clientId: "arg-id", clientSecret: "arg-secret" });
      expect(creds).toEqual({ clientId: "arg-id", clientSecret: "arg-secret" });
    } finally {
      if (prevId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
      else process.env.CF_ACCESS_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET;
      else process.env.CF_ACCESS_CLIENT_SECRET = prevSecret;
    }
  });

  test("falls back to env vars when no args given", () => {
    const prevId = process.env.CF_ACCESS_CLIENT_ID;
    const prevSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    process.env.CF_ACCESS_CLIENT_ID = "env-id";
    process.env.CF_ACCESS_CLIENT_SECRET = "env-secret";
    try {
      expect(resolveAccessCredentials({})).toEqual({
        clientId: "env-id",
        clientSecret: "env-secret",
      });
    } finally {
      if (prevId === undefined) delete process.env.CF_ACCESS_CLIENT_ID;
      else process.env.CF_ACCESS_CLIENT_ID = prevId;
      if (prevSecret === undefined) delete process.env.CF_ACCESS_CLIENT_SECRET;
      else process.env.CF_ACCESS_CLIENT_SECRET = prevSecret;
    }
  });

  test("returns undefined when nothing is configured (and no .provision file exists)", () => {
    const prevId = process.env.CF_ACCESS_CLIENT_ID;
    const prevSecret = process.env.CF_ACCESS_CLIENT_SECRET;
    delete process.env.CF_ACCESS_CLIENT_ID;
    delete process.env.CF_ACCESS_CLIENT_SECRET;
    try {
      // Inject a reader that finds no .provision file, so the assertion holds
      // even on a machine where real Access creds are provisioned locally.
      expect(resolveAccessCredentials({}, () => undefined)).toBeUndefined();
    } finally {
      if (prevId !== undefined) process.env.CF_ACCESS_CLIENT_ID = prevId;
      if (prevSecret !== undefined) process.env.CF_ACCESS_CLIENT_SECRET = prevSecret;
    }
  });
});
