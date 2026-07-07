#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { discoverOgDefinitions } from "./discover.ts";
import { renderOg } from "./render.ts";

async function build(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      cwd: { type: "string" },
      out: { type: "string" },
      glob: { type: "string" },
    },
    strict: true,
    allowPositionals: false,
  });

  const cwd = resolve(values.cwd ?? process.cwd());
  const outDir = resolve(cwd, values.out ?? "public/og");
  const pattern = values.glob ?? "og/**/*.og.{tsx,ts}";

  const entries = await discoverOgDefinitions(cwd, pattern);
  if (entries.length === 0) {
    console.error(`platform-og: no files matched ${pattern} in ${cwd}`);
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });

  const t0 = performance.now();
  for (const { file, definition } of entries) {
    const element = await definition.render();
    try {
      const png = await renderOg(element, { size: definition.size });
      const dest = resolve(outDir, `${definition.name}.png`);
      await writeFile(dest, png);
      console.log(`  ✓ ${definition.name}.png  ${definition.size.width}×${definition.size.height}`);
    } catch (err) {
      console.error(`  ✗ ${file}`);
      throw err;
    }
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`platform-og: rendered ${entries.length} image(s) into ${outDir} in ${ms}ms`);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (command === "build" || command === undefined) {
    await build(rest);
    return;
  }
  console.error(`platform-og: unknown command "${command}"`);
  console.error("usage: platform-og build [--cwd <dir>] [--out <dir>] [--glob <pattern>]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
