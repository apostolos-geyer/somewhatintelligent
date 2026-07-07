import { describe, expect, test } from "vitest";
import { defaultColorHex } from "@/lib/theme-defaults";
import { COLOR_TOKEN_KEYS } from "@/lib/theme-tokens";

describe("defaultColorHex", () => {
  test("resolves every colour token to a #rrggbb in both modes", () => {
    for (const key of COLOR_TOKEN_KEYS) {
      for (const mode of ["light", "dark"] as const) {
        const hex = defaultColorHex(key, mode);
        expect(hex, `${key} (${mode})`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  test("differs between light and dark for mode-sensitive tokens", () => {
    // The brand green is deep on cream (light) and a bright lime glow on the
    // espresso canvas (dark) — never the same hex.
    expect(defaultColorHex("sprout", "light")).not.toBe(defaultColorHex("sprout", "dark"));
    expect(defaultColorHex("bg", "light")).not.toBe(defaultColorHex("bg", "dark"));
  });

  test("maps a neutral and an accent hover to the design-system hex", () => {
    // bg light === the cream paper surface, as the HSL token resolves to hex
    // (matches what codegen emits for `--color-bg`); sprout-hover is the accent's
    // distinct hover variant.
    expect(defaultColorHex("bg", "light")).toBe("#f3f3ec");
    expect(defaultColorHex("sprout-hover", "light")).not.toBe(defaultColorHex("sprout", "light"));
  });

  test("returns null for an unknown key", () => {
    expect(defaultColorHex("not-a-token", "light")).toBeNull();
  });
});
