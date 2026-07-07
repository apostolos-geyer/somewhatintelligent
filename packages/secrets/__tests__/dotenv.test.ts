import { describe, expect, test } from "vitest";
import {
  escapeDotenvValue,
  mergeDevVars,
  parseDotenv,
  serializeDotenv,
  unescapeDotenvValue,
} from "../src/dotenv";

describe("escape / unescape round-trip", () => {
  test("multi-line PEM survives", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nMC4wBQYDK2Vw\n-----END PRIVATE KEY-----";
    expect(unescapeDotenvValue(escapeDotenvValue(pem))).toBe(pem);
  });
  test("quotes and backslashes survive", () => {
    const value = 'a"b\\c';
    expect(unescapeDotenvValue(escapeDotenvValue(value))).toBe(value);
  });
});

describe("parseDotenv", () => {
  test("ignores comments and blanks, reads key/values", () => {
    expect(parseDotenv('# comment\n\nA=1\nB="x"\n')).toEqual({ A: "1", B: "x" });
  });
});

describe("serializeDotenv", () => {
  test("sorts keys and round-trips through parseDotenv", () => {
    const values = { B: "2", A: "1" };
    const out = serializeDotenv(values);
    expect(out.indexOf("A=")).toBeLessThan(out.indexOf("B="));
    expect(parseDotenv(out)).toEqual(values);
  });
});

describe("mergeDevVars", () => {
  test("upserts secret keys while preserving comments + other vars", () => {
    const existing = '# header\nENVIRONMENT=development\nBETTER_AUTH_SECRET="old"\n';
    const out = mergeDevVars(existing, {
      BETTER_AUTH_SECRET: "new",
      GOOGLE_CLIENT_ID: "gid",
    });
    expect(out).toContain("# header");
    expect(out).toContain("ENVIRONMENT=development");
    expect(out).toMatch(/BETTER_AUTH_SECRET="new"/);
    expect(out).not.toContain('"old"');
    expect(out).toMatch(/GOOGLE_CLIENT_ID="gid"/);
  });

  test("is idempotent — re-merging the same updates is a no-op", () => {
    const existing = "ENVIRONMENT=development\n";
    const updates = { BETTER_AUTH_SECRET: "x", GOOGLE_CLIENT_ID: "y" };
    const once = mergeDevVars(existing, updates);
    expect(mergeDevVars(once, updates)).toBe(once);
  });

  test("handles empty existing body", () => {
    expect(parseDotenv(mergeDevVars("", { A: "1" }))).toEqual({ A: "1" });
  });
});
