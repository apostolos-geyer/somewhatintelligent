import { pathToFileURL } from "node:url";
import { glob } from "tinyglobby";
import type { OgDefinition } from "./define.ts";

export type DiscoveredOg = {
  file: string;
  definition: OgDefinition;
};

export async function discoverOgDefinitions(
  cwd: string,
  pattern = "og/**/*.og.{tsx,ts}",
): Promise<DiscoveredOg[]> {
  const files = await glob(pattern, { cwd, absolute: true });
  files.sort();

  const discovered: DiscoveredOg[] = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(file).href)) as { default?: OgDefinition };
    if (!mod.default) {
      throw new Error(`${file} has no default export — use \`export default defineOg({...})\``);
    }
    assertOgDefinition(file, mod.default);
    discovered.push({ file, definition: mod.default });
  }
  return discovered;
}

function assertOgDefinition(file: string, value: unknown): asserts value is OgDefinition {
  if (!value || typeof value !== "object") {
    throw new Error(`${file}: default export is not an OgDefinition object`);
  }
  const v = value as Partial<OgDefinition>;
  if (typeof v.name !== "string" || !v.name) {
    throw new Error(`${file}: OgDefinition.name must be a non-empty string`);
  }
  if (!v.size || typeof v.size.width !== "number" || typeof v.size.height !== "number") {
    throw new Error(`${file}: OgDefinition.size must be { width, height }`);
  }
  if (typeof v.render !== "function") {
    throw new Error(`${file}: OgDefinition.render must be a function`);
  }
}
