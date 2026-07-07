import { describe, expect, test } from "vite-plus/test";
import {
  backfillDatabaseId,
  backfillJsonField,
  buildTokenPolicies,
  corsOriginsForEnv,
  envScope,
  findEnclosingBraces,
  findZoneForHost,
  isZoneScoped,
  listD1Entries,
  listR2Entries,
  listWorkersDevEnabled,
  mapPermissionGroupsByName,
  parseCliArgs,
  parseJsonc,
  stripJsonComments,
  stripTrailingCommas,
  type PermissionGroup,
  type WorkerConfigFile,
} from "../lib";

// ---------------------------------------------------------------------------
// stripJsonComments / parseJsonc
// ---------------------------------------------------------------------------

describe("stripJsonComments", () => {
  test("strips line comments but leaves // inside strings alone", () => {
    const src = `{
      // a leading comment
      "url": "https://example.com", // a trailing comment
      "note": "not // a comment"
    }`;
    const stripped = stripJsonComments(src);
    expect(stripped).not.toContain("leading comment");
    expect(stripped).not.toContain("trailing comment");
    expect(stripped).toContain('"url": "https://example.com"');
    // The identical-looking "//" sequence INSIDE a string is preserved verbatim.
    expect(stripped).toContain('"note": "not // a comment"');
  });

  test("strips block comments spanning multiple lines", () => {
    const src = `{
      /* multi
         line
         comment */
      "a": 1
    }`;
    expect(stripJsonComments(src)).not.toContain("multi");
  });

  test("leaves an escaped quote inside a string alone", () => {
    const src = `{ "a": "he said \\"hi\\" // not a comment" }`;
    const stripped = stripJsonComments(src);
    expect(stripped).toContain('he said \\"hi\\" // not a comment');
  });
});

describe("parseJsonc", () => {
  test("parses comments + trailing commas like wrangler.jsonc", () => {
    const src = `{
      // top-level worker name
      "name": "si-roadie-staging",
      "vars": {
        "R2_BUCKET": "roadie-staging-blobs", // trailing comma below
      },
    }`;
    const parsed = parseJsonc<{ name: string; vars: { R2_BUCKET: string } }>(src);
    expect(parsed.name).toBe("si-roadie-staging");
    expect(parsed.vars.R2_BUCKET).toBe("roadie-staging-blobs");
  });
});

describe("stripTrailingCommas", () => {
  test("removes trailing commas before closing brackets only", () => {
    expect(stripTrailingCommas('{"a":[1,2,],"b":3,}')).toBe('{"a":[1,2],"b":3}');
  });
});

// ---------------------------------------------------------------------------
// wrangler.jsonc fixtures — d1/r2 scanning + envScope
// ---------------------------------------------------------------------------

const ROADIE_FIXTURE = `{
  "name": "si-roadie-staging",
  "workers_dev": false,
  "vars": { "R2_BUCKET": "roadie-staging-blobs" },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "roadie-staging-db",
      "database_id": "00000000-0000-0000-0000-000000000000",
      "migrations_dir": "migrations",
    },
  ],
  "r2_buckets": [
    { "binding": "BLOBS", "bucket_name": "roadie-staging-blobs" },
  ],
  "env": {
    "production": {
      "name": "si-roadie-production",
      "vars": { "R2_BUCKET": "roadie-production-blobs" },
      "d1_databases": [
        {
          "binding": "DB",
          "database_name": "roadie-production-db",
          "database_id": "d433005f-a673-420b-b8f5-f1fbf6276ac8",
          "migrations_dir": "migrations",
        },
      ],
      "r2_buckets": [
        { "binding": "BLOBS", "bucket_name": "roadie-production-blobs" },
      ],
    },
  },
}`;

// Field order deliberately differs from the roadie fixture (database_id
// BEFORE migrations_dir vs AFTER) — this is the real discrepancy between
// guestlist and roadie's checked-in wrangler.jsonc in the source template,
// and exactly why the backfill can't assume a fixed field order.
const GUESTLIST_FIXTURE = `{
  // staging config
  "name": "si-guestlist-staging",
  "workers_dev": true,
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "guestlist-staging-db",
      "migrations_dir": "migrations",
      "database_id": "a3843194-c218-4ff4-b656-dbe29e719ba2",
    },
  ],
}`;

function fixtureConfig(dir: string, raw: string): WorkerConfigFile {
  return { dir, path: `/repo/${dir}/wrangler.jsonc`, raw, parsed: parseJsonc(raw) };
}

describe("envScope", () => {
  test("staging returns the top-level config", () => {
    const cfg = fixtureConfig("workers/roadie", ROADIE_FIXTURE);
    expect(envScope(cfg.parsed, "staging")?.name).toBe("si-roadie-staging");
  });

  test("production returns env.production, not a merge of the top level", () => {
    const cfg = fixtureConfig("workers/roadie", ROADIE_FIXTURE);
    const scope = envScope(cfg.parsed, "production");
    expect(scope?.name).toBe("si-roadie-production");
    expect(scope?.vars).toEqual({ R2_BUCKET: "roadie-production-blobs" });
  });
});

describe("listD1Entries / listR2Entries", () => {
  const configs = [
    fixtureConfig("workers/roadie", ROADIE_FIXTURE),
    fixtureConfig("workers/guestlist", GUESTLIST_FIXTURE),
  ];

  test("collects d1 entries for staging", () => {
    const entries = listD1Entries(configs, "staging");
    expect(entries).toEqual([
      {
        workerDir: "workers/roadie",
        workerName: "si-roadie-staging",
        binding: "DB",
        databaseName: "roadie-staging-db",
        databaseId: "00000000-0000-0000-0000-000000000000",
      },
      {
        workerDir: "workers/guestlist",
        workerName: "si-guestlist-staging",
        binding: "DB",
        databaseName: "guestlist-staging-db",
        databaseId: "a3843194-c218-4ff4-b656-dbe29e719ba2",
      },
    ]);
  });

  test("collects d1 entries for production (guestlist has none -> excluded)", () => {
    const entries = listD1Entries(configs, "production");
    expect(entries).toEqual([
      {
        workerDir: "workers/roadie",
        workerName: "si-roadie-production",
        binding: "DB",
        databaseName: "roadie-production-db",
        databaseId: "d433005f-a673-420b-b8f5-f1fbf6276ac8",
      },
    ]);
  });

  test("collects r2 entries for staging", () => {
    const entries = listR2Entries(configs, "staging");
    expect(entries).toEqual([
      {
        workerDir: "workers/roadie",
        workerName: "si-roadie-staging",
        binding: "BLOBS",
        bucketName: "roadie-staging-blobs",
      },
    ]);
  });

  test("listWorkersDevEnabled only returns top-level workers_dev:true", () => {
    expect(listWorkersDevEnabled(configs)).toEqual([
      { workerDir: "workers/guestlist", workerName: "si-guestlist-staging" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// comment-preserving id backfill
// ---------------------------------------------------------------------------

describe("findEnclosingBraces", () => {
  test("finds the innermost object around an offset", () => {
    const raw = '{"outer": {"inner": {"a": 1}}}';
    const offset = raw.indexOf('"a"');
    const [start, end] = findEnclosingBraces(raw, offset);
    expect(raw.slice(start, end + 1)).toBe('{"a": 1}');
  });
});

describe("backfillJsonField / backfillDatabaseId", () => {
  test("replaces database_id when it appears AFTER database_name in the object", () => {
    const result = backfillDatabaseId(
      ROADIE_FIXTURE,
      "roadie-staging-db",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(result.changed).toBe(true);
    expect(result.oldValue).toBe("00000000-0000-0000-0000-000000000000");
    expect(result.raw).toContain('"database_id": "11111111-1111-1111-1111-111111111111"');
    // The production block's database_id must be untouched.
    expect(result.raw).toContain('"database_id": "d433005f-a673-420b-b8f5-f1fbf6276ac8"');
  });

  test("replaces database_id when it appears BEFORE... (order-independent) and preserves comments", () => {
    const result = backfillDatabaseId(
      GUESTLIST_FIXTURE,
      "guestlist-staging-db",
      "22222222-2222-2222-2222-222222222222",
    );
    expect(result.changed).toBe(true);
    expect(result.raw).toContain('"database_id": "22222222-2222-2222-2222-222222222222"');
    expect(result.raw).toContain("// staging config"); // comment preserved verbatim
    expect(result.raw).toContain('"migrations_dir": "migrations"'); // unrelated field untouched
  });

  test("is a no-op when the id already matches (idempotent re-run)", () => {
    const first = backfillDatabaseId(
      ROADIE_FIXTURE,
      "roadie-staging-db",
      "11111111-1111-1111-1111-111111111111",
    );
    const second = backfillDatabaseId(
      first.raw,
      "roadie-staging-db",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(second.changed).toBe(false);
    expect(second.raw).toBe(first.raw);
  });

  test("no-op when the database_name isn't present", () => {
    const result = backfillDatabaseId(
      ROADIE_FIXTURE,
      "does-not-exist-db",
      "33333333-3333-3333-3333-333333333333",
    );
    expect(result.changed).toBe(false);
    expect(result.raw).toBe(ROADIE_FIXTURE);
  });

  test("backfillJsonField only touches the matched object, not a same-named field elsewhere", () => {
    const raw =
      '{"a": {"database_name": "x", "id": "old"}, "b": {"database_name": "y", "id": "old"}}';
    const result = backfillJsonField(raw, /"database_name"\s*:\s*"x"/, "id", "new");
    expect(result.raw).toBe(
      '{"a": {"database_name": "x", "id": "new"}, "b": {"database_name": "y", "id": "old"}}',
    );
  });
});

// ---------------------------------------------------------------------------
// longest-suffix zone matching
// ---------------------------------------------------------------------------

describe("findZoneForHost", () => {
  const zones = [
    { id: "z-apex", name: "somewhatintelligent.ca" },
    { id: "z-other", name: "example.com" },
    { id: "z-couk", name: "example.co.uk" },
  ];

  test("exact match wins outright", () => {
    expect(findZoneForHost("somewhatintelligent.ca", zones)).toEqual({
      id: "z-apex",
      name: "somewhatintelligent.ca",
    });
  });

  test("picks the zone by longest-suffix for a subdomain", () => {
    expect(findZoneForHost("mail.somewhatintelligent.ca", zones)).toEqual({
      id: "z-apex",
      name: "somewhatintelligent.ca",
    });
  });

  test("prefers the longer registered zone name over a shorter coincidental suffix", () => {
    expect(findZoneForHost("mail.example.co.uk", zones)).toEqual({
      id: "z-couk",
      name: "example.co.uk",
    });
  });

  test("returns null when nothing matches", () => {
    expect(findZoneForHost("mail.unrelated.dev", zones)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// CORS origin derivation
// ---------------------------------------------------------------------------

describe("corsOriginsForEnv", () => {
  test("production is the apex + www, no wildcards", () => {
    const origins = corsOriginsForEnv("production", "somewhatintelligent.ca");
    expect(origins).toEqual([
      "https://somewhatintelligent.ca",
      "https://www.somewhatintelligent.ca",
    ]);
  });

  test("staging includes the staging portal host and a localhost dev origin", () => {
    const origins = corsOriginsForEnv("staging", "somewhatintelligent.ca");
    expect(origins).toContain("https://staging.somewhatintelligent.ca");
    expect(origins.some((o) => o.includes("localhost"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// permission-group name resolution mapping
// ---------------------------------------------------------------------------

describe("mapPermissionGroupsByName", () => {
  const groups: PermissionGroup[] = [
    { id: "1", name: "D1 Write", scopes: ["com.cloudflare.api.account"] },
    { id: "2", name: "DNS Write", scopes: ["com.cloudflare.api.account.zone"] },
    { id: "3", name: "Workers Scripts Write", scopes: ["com.cloudflare.api.account"] },
  ];

  test("resolves known names in the requested order", () => {
    const { resolved, missing } = mapPermissionGroupsByName(groups, ["DNS Write", "D1 Write"]);
    expect(resolved.map((g) => g.name)).toEqual(["DNS Write", "D1 Write"]);
    expect(missing).toEqual([]);
  });

  test("reports unresolvable names without throwing", () => {
    const { resolved, missing } = mapPermissionGroupsByName(groups, [
      "D1 Write",
      "Nonexistent Group",
    ]);
    expect(resolved.map((g) => g.name)).toEqual(["D1 Write"]);
    expect(missing).toEqual(["Nonexistent Group"]);
  });

  test("first entry wins on a duplicate name", () => {
    const dup: PermissionGroup[] = [
      { id: "a", name: "D1 Write", scopes: [] },
      { id: "b", name: "D1 Write", scopes: [] },
    ];
    const { resolved } = mapPermissionGroupsByName(dup, ["D1 Write"]);
    expect(resolved).toEqual([{ id: "a", name: "D1 Write", scopes: [] }]);
  });
});

describe("isZoneScoped / buildTokenPolicies", () => {
  const accountGroup: PermissionGroup = {
    id: "acct-1",
    name: "Workers Scripts Write",
    scopes: ["com.cloudflare.api.account"],
  };
  const zoneGroup: PermissionGroup = {
    id: "zone-1",
    name: "DNS Write",
    scopes: ["com.cloudflare.api.account.zone"],
  };

  test("isZoneScoped distinguishes account vs zone resources", () => {
    expect(isZoneScoped(accountGroup)).toBe(false);
    expect(isZoneScoped(zoneGroup)).toBe(true);
  });

  test("splits groups into an account policy and a zone policy", () => {
    const policies = buildTokenPolicies([accountGroup, zoneGroup], "acct-id", "zone-id");
    expect(policies).toEqual([
      {
        effect: "allow",
        permission_groups: [{ id: "acct-1" }],
        resources: { "com.cloudflare.api.account.acct-id": "*" },
      },
      {
        effect: "allow",
        permission_groups: [{ id: "zone-1" }],
        resources: { "com.cloudflare.api.account.zone.zone-id": "*" },
      },
    ]);
  });

  test("omits the zone policy entirely when no zone-scoped groups are requested", () => {
    const policies = buildTokenPolicies([accountGroup], "acct-id", undefined);
    expect(policies).toEqual([
      {
        effect: "allow",
        permission_groups: [{ id: "acct-1" }],
        resources: { "com.cloudflare.api.account.acct-id": "*" },
      },
    ]);
  });

  test("throws when a zone-scoped group is requested but no zone id is available", () => {
    expect(() => buildTokenPolicies([zoneGroup], "acct-id", undefined)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

describe("parseCliArgs", () => {
  test("defaults to staging, no dry-run", () => {
    const args = parseCliArgs([]);
    expect(args.env).toBe("staging");
    expect(args.dryRun).toBe(false);
    expect(args.writeSecrets).toBe(false);
  });

  test("parses --env=production and --dry-run", () => {
    const args = parseCliArgs(["--env=production", "--dry-run"]);
    expect(args.env).toBe("production");
    expect(args.dryRun).toBe(true);
  });

  test("parses --env staging as two tokens", () => {
    const args = parseCliArgs(["--env", "staging"]);
    expect(args.env).toBe("staging");
  });

  test("rejects an invalid --env", () => {
    expect(() => parseCliArgs(["--env=bogus"])).toThrow();
  });

  test("--write-secrets sets writeSecrets", () => {
    expect(parseCliArgs(["--write-secrets"]).writeSecrets).toBe(true);
  });
});
