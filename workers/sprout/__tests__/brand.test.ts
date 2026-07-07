import { describe, expect, test } from "vitest";
import {
  brandAccent,
  brandThemeToCss,
  compactTheme,
  parseBrandTheme,
  parseSections,
  resolveEnabledSections,
  resolveFixedMode,
  sanitizeCssValue,
  slugFromHost,
  themeToStyleVars,
} from "@/lib/brand";
import { COLOR_TOKEN_KEYS, THEME_TOKENS } from "@/lib/theme-tokens";
import { DEMO_BRANDS } from "./fixtures";

describe("slugFromHost", () => {
  test("extracts the leftmost label of a single-label brand subdomain", () => {
    expect(slugFromHost("mtl.sproutportal.ca")).toBe("mtl");
    expect(slugFromHost("dom.sproutportal.localhost")).toBe("dom");
    expect(slugFromHost("MTL.sproutportal.ca")).toBe("mtl"); // lowercased
    expect(slugFromHost("mtl.sproutportal.localhost:5173")).toBe("mtl"); // port stripped
  });
  test("returns null for the apex (→ Hub), multi-label, and foreign hosts", () => {
    expect(slugFromHost("sproutportal.ca")).toBeNull();
    expect(slugFromHost("sproutportal.localhost")).toBeNull();
    expect(slugFromHost("a.b.sproutportal.ca")).toBeNull();
    expect(slugFromHost("example.com")).toBeNull();
    expect(slugFromHost(null)).toBeNull();
    expect(slugFromHost("")).toBeNull();
  });
});

describe("theme token registry", () => {
  test("every cssVar is unique", () => {
    const seen = new Set(THEME_TOKENS.map((t) => t.cssVar));
    expect(seen.size).toBe(THEME_TOKENS.length);
  });
  test("colour keys cover the semantic palette", () => {
    for (const k of [
      "bg",
      "surface",
      "border",
      "text",
      "sprout",
      "stigma",
      "growth",
      "pistil",
      "haze",
    ]) {
      expect(COLOR_TOKEN_KEYS).toContain(k);
    }
  });
});

describe("parseBrandTheme — v2 + allow-list", () => {
  test("filters every map against the token allow-list, keeps policy", () => {
    const t = parseBrandTheme(
      JSON.stringify({
        modePolicy: "fixed",
        fixedMode: "dark",
        light: { sprout: "#0f0", bogus: "#fff" },
        dark: { bg: "#000" },
        radius: { sm: "4px", nope: "1px" },
        spacing: { base: "0.2rem" },
        fonts: { display: "'Bebas Neue', sans-serif", junk: "x" },
      }),
    );
    expect(t.light).toEqual({ sprout: "#0f0" });
    expect(t.dark).toEqual({ bg: "#000" });
    expect(t.radius).toEqual({ sm: "4px" });
    expect(t.spacing).toEqual({ base: "0.2rem" });
    expect(t.fonts).toEqual({ display: "'Bebas Neue', sans-serif" });
    expect(t.modePolicy).toBe("fixed");
    expect(t.fixedMode).toBe("dark");
  });
  test("drops non-string and empty values", () => {
    const t = parseBrandTheme(JSON.stringify({ light: { sprout: 123, bg: "#000", text: "" } }));
    expect(t.light).toEqual({ bg: "#000" });
  });
  test("garbage / empty collapse to {}", () => {
    expect(parseBrandTheme("not json")).toEqual({});
    expect(parseBrandTheme(null)).toEqual({});
    expect(parseBrandTheme("{}")).toEqual({});
  });
});

describe("parseBrandTheme — legacy v1 migration", () => {
  test("primary→light+dark sprout, background→light bg, fonts; inert accent dropped", () => {
    const t = parseBrandTheme(
      '{"colors":{"primary":"#1f6f3c","accent":"#caa14b","background":"#fff"},"font":{"display":"X","body":"Y"}}',
    );
    expect(t.light).toEqual({ sprout: "#1f6f3c", bg: "#fff" });
    expect(t.dark).toEqual({ sprout: "#1f6f3c" });
    expect(t.fonts).toEqual({ display: "X", body: "Y" });
    expect(JSON.stringify(t)).not.toContain("caa14b"); // inert v1 accent dropped
  });
});

describe("brandThemeToCss — v2 generation", () => {
  test("adaptive: light→:root, dark→[data-theme=dark]; globals→:root only", () => {
    const css = brandThemeToCss({
      light: { sprout: "#0a0", bg: "#fff" },
      dark: { sprout: "#3f3" },
      radius: { sm: "4px" },
      fonts: { display: "'Bebas Neue', sans-serif" },
    });
    const cut = css.indexOf('[data-theme="dark"]');
    const root = css.slice(0, cut);
    const dark = css.slice(cut);
    expect(root).toContain("--color-sprout:#0a0");
    expect(root).toContain("--color-bg:#fff");
    expect(root).toContain("--radius-sm:4px");
    expect(root).toContain("--font-display:'Bebas Neue', sans-serif");
    expect(dark).toContain("--color-sprout:#3f3");
    expect(dark).not.toContain("--radius-sm"); // globals never duplicated into dark
  });

  test("fixed dark: palette → [data-theme=dark]; globals stay in :root", () => {
    const css = brandThemeToCss({
      modePolicy: "fixed",
      fixedMode: "dark",
      light: { bg: "#000", sprout: "#9f9" },
      radius: { sm: "0px" },
    });
    const cut = css.indexOf('[data-theme="dark"]');
    const root = css.slice(0, cut);
    const dark = css.slice(cut);
    expect(root).toContain("--radius-sm:0px");
    expect(dark).toContain("--color-bg:#000");
    expect(dark).toContain("--color-sprout:#9f9");
  });

  test("fixed light: palette stays in :root, no dark block", () => {
    const css = brandThemeToCss({ modePolicy: "fixed", fixedMode: "light", light: { bg: "#eee" } });
    expect(css).toContain(":root{");
    expect(css).toContain("--color-bg:#eee");
    expect(css).not.toContain('[data-theme="dark"]');
  });

  test("sanitizes — a config value cannot break out of <style> or the declaration", () => {
    const css = brandThemeToCss({ light: { sprout: "#000;}</style><script>" } });
    expect(css).not.toContain("</style>");
    expect(css).not.toContain("<script>");
    expect(css).not.toContain(";}");
  });

  test("allows quotes so multi-word font families survive", () => {
    const css = brandThemeToCss({ fonts: { display: `"Bebas Neue", sans-serif` } });
    expect(css).toContain(`--font-display:"Bebas Neue", sans-serif`);
  });

  test("empty theme → empty string (default Sprout skin)", () => {
    expect(brandThemeToCss({})).toBe("");
    expect(brandThemeToCss({ light: {} })).toBe("");
  });
});

describe("compactTheme — drops unset buckets so the wire payload has no explicit undefined", () => {
  // The editor spreads every slot, so after a "Reset to defaults" all buckets are
  // `undefined`. seroval keeps undefined props on the wire and the server's
  // optional-key validator rejects them, so Save never cleared the draft and
  // Publish re-copied the old colours — the reported bug. compactTheme strips them.
  test("a fully-reset theme compacts to an empty object", () => {
    expect(compactTheme({})).toEqual({});
    expect(
      compactTheme({
        modePolicy: undefined,
        fixedMode: undefined,
        light: undefined,
        dark: undefined,
        radius: undefined,
        spacing: undefined,
        fonts: undefined,
      }),
    ).toEqual({});
  });

  test("keeps only the buckets that are actually set", () => {
    expect(compactTheme({ light: { sprout: "#0a0" }, dark: undefined, fonts: undefined })).toEqual({
      light: { sprout: "#0a0" },
    });
    expect(compactTheme({ modePolicy: "fixed", fixedMode: "dark" })).toEqual({
      modePolicy: "fixed",
      fixedMode: "dark",
    });
  });
});

describe("resolveFixedMode + themeToStyleVars", () => {
  test("resolveFixedMode: adaptive → null; fixed → mode (defaults light)", () => {
    expect(resolveFixedMode({})).toBeNull();
    expect(resolveFixedMode({ modePolicy: "fixed" })).toBe("light");
    expect(resolveFixedMode({ modePolicy: "fixed", fixedMode: "dark" })).toBe("dark");
  });
  test("themeToStyleVars: flat --var map for one appearance (globals + that palette)", () => {
    const vars = themeToStyleVars(
      { light: { sprout: "#0a0" }, dark: { sprout: "#3f3" }, radius: { sm: "2px" } },
      "dark",
    );
    expect(vars["--color-sprout"]).toBe("#3f3");
    expect(vars["--radius-sm"]).toBe("2px");
  });
  test("themeToStyleVars: fixed always uses the single (light) palette", () => {
    const vars = themeToStyleVars(
      { modePolicy: "fixed", fixedMode: "dark", light: { bg: "#000" } },
      "light",
    );
    expect(vars["--color-bg"]).toBe("#000");
  });
});

describe("sanitizeCssValue", () => {
  test("strips breakout chars, keeps colour/length/font syntax", () => {
    expect(sanitizeCssValue("#1f6f3c")).toBe("#1f6f3c");
    expect(sanitizeCssValue("clamp(12px, 2vw, 20px)")).toBe("clamp(12px, 2vw, 20px)");
    expect(sanitizeCssValue("hsl(122 55% 28%)")).toBe("hsl(122 55% 28%)");
    expect(sanitizeCssValue("a;}<>:/{b")).toBe("ab");
  });
});

describe("parseSections + resolveEnabledSections", () => {
  test("empty/garbage config ⇒ all six sections, canonical order", () => {
    expect(resolveEnabledSections(parseSections(null))).toEqual([
      "assets",
      "decks",
      "quizzes",
      "feed",
      "chat",
      "contact",
    ]);
    expect(resolveEnabledSections(parseSections("[]"))).toHaveLength(6);
    expect(resolveEnabledSections(parseSections("not json"))).toHaveLength(6);
  });

  test("filters disabled, sorts by order, drops non-canonical keys", () => {
    const json = JSON.stringify([
      { key: "chat", enabled: true, order: 1 },
      { key: "assets", enabled: true, order: 0 },
      { key: "decks", enabled: false, order: 2 },
      { key: "bogus", enabled: true, order: 3 },
    ]);
    expect(resolveEnabledSections(parseSections(json))).toEqual(["assets", "chat"]);
  });
});

describe("two seeded brands → two visibly different skins (one engine, infinite skins)", () => {
  test("the demo brands produce distinct --color-sprout blocks (via v1 migration)", () => {
    const [mtl, dom] = DEMO_BRANDS;
    const cssA = brandThemeToCss(parseBrandTheme(JSON.stringify({ colors: mtl!.theme.colors })));
    const cssB = brandThemeToCss(parseBrandTheme(JSON.stringify({ colors: dom!.theme.colors })));
    expect(cssA).toContain(`--color-sprout:${mtl!.theme.colors.primary}`);
    expect(cssB).toContain(`--color-sprout:${dom!.theme.colors.primary}`);
    expect(cssA).not.toEqual(cssB);
  });
});

describe("brandAccent — the Hub-tile identity colour", () => {
  test("returns the retinted primary (light, falling back to dark)", () => {
    expect(brandAccent({ light: { sprout: "#1f6f3c" } })).toBe("#1f6f3c");
    expect(brandAccent({ dark: { sprout: "#7b2d8e" } })).toBe("#7b2d8e");
    expect(brandAccent({ light: { sprout: "#aaa" }, dark: { sprout: "#bbb" } })).toBe("#aaa");
  });
  test("null when the brand sets no primary", () => {
    expect(brandAccent({})).toBeNull();
    expect(brandAccent({ light: { bg: "#fff" } })).toBeNull();
  });
  test("sanitizes so the value can't break out of the inline style it's injected into", () => {
    // The dangerous `;{}<>:/` chars are stripped (same rule as sanitizeCssValue).
    expect(brandAccent({ light: { sprout: "a;}<>:/{b" } })).toBe("ab");
  });
  test("the demo brands each yield their own distinct accent (via v1 migration)", () => {
    const [mtl, dom] = DEMO_BRANDS;
    const a = brandAccent(parseBrandTheme(JSON.stringify({ colors: mtl!.theme.colors })));
    const b = brandAccent(parseBrandTheme(JSON.stringify({ colors: dom!.theme.colors })));
    expect(a).toBe(mtl!.theme.colors.primary);
    expect(b).toBe(dom!.theme.colors.primary);
    expect(a).not.toEqual(b);
  });
});
