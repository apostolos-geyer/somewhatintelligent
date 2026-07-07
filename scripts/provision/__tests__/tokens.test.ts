import { describe, expect, test } from "vite-plus/test";
import { currentGroupIds, sameGroupSet, TOKEN_SPECS } from "../tokens";
import type { PermissionGroup } from "../lib";

describe("TOKEN_SPECS", () => {
  test("every spec has a unique name and at least one permission group", () => {
    const names = TOKEN_SPECS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
    for (const spec of TOKEN_SPECS) expect(spec.permissionGroups.length).toBeGreaterThan(0);
  });

  test("si-preview is scoped to Workers Scripts + Account Settings Read only (no deploy-time zone perms)", () => {
    const preview = TOKEN_SPECS.find((s) => s.name === "si-preview")!;
    expect(preview.permissionGroups).toEqual(["Workers Scripts Write", "Account Settings Read"]);
  });

  test("si-deploy includes the zone-scoped groups custom-domain creation needs", () => {
    const deploy = TOKEN_SPECS.find((s) => s.name === "si-deploy")!;
    expect(deploy.permissionGroups).toEqual(
      expect.arrayContaining(["DNS Write", "SSL and Certificates Write", "Workers Routes Write"]),
    );
  });
});

describe("currentGroupIds / sameGroupSet", () => {
  const groups: PermissionGroup[] = [
    { id: "1", name: "D1 Write", scopes: [] },
    { id: "2", name: "DNS Write", scopes: [] },
  ];

  test("currentGroupIds flattens ids across all policies on a token", () => {
    const token = {
      policies: [{ permission_groups: [{ id: "1" }] }, { permission_groups: [{ id: "2" }] }],
    } as unknown as Parameters<typeof currentGroupIds>[0];
    expect(currentGroupIds(token)).toEqual(new Set(["1", "2"]));
  });

  test("sameGroupSet is true only when both sets match exactly", () => {
    expect(sameGroupSet(groups, new Set(["1", "2"]))).toBe(true);
    expect(sameGroupSet(groups, new Set(["1"]))).toBe(false);
    expect(sameGroupSet(groups, new Set(["1", "2", "3"]))).toBe(false);
  });
});
