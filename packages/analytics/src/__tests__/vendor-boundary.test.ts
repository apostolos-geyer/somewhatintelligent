import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";

const VENDOR = /from\s+["'](posthog-node|posthog-js|@posthog\/react)["']/;
const repoRoot = (d = import.meta.dirname): string => {
  while (!existsSync(join(d, "bun.lock"))) {
    const up = dirname(d);
    if (up === d) throw new Error("no root");
    d = up;
  }
  return d;
};
const walk = (dir: string, hits: string[]) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, hits);
    else if (/\.tsx?$/.test(e.name) && VENDOR.test(readFileSync(p, "utf8"))) hits.push(p);
  }
};

test("posthog vendor deps are imported only inside @si/analytics", () => {
  const root = repoRoot(),
    hits: string[] = [];
  for (const base of ["workers", "packages"]) walk(join(root, base), hits);
  const leaks = hits.filter((p) => !p.includes(join("packages", "analytics")));
  expect(leaks, `posthog imported outside @si/analytics:\n${leaks.join("\n")}`).toEqual([]);
});
