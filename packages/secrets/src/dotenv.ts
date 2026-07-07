/**
 * Minimal dotenv read/write tuned to wrangler's `.dev.vars` conventions:
 * double-quoted values with `\n` escapes (how multi-line PEM keys are stored).
 * Kept dependency-free and pure so it's trivially testable.
 */

/** Quote + escape a value for a `.dev.vars` / store line. */
export function escapeDotenvValue(value: string): string {
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/** Inverse of {@link escapeDotenvValue}; tolerates unquoted values too. */
export function unescapeDotenvValue(raw: string): string {
  const v = raw.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
    return v.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return v;
}

/** Parse a dotenv body into a flat record (comments / blanks ignored). */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    if (key.length === 0) continue;
    out[key] = unescapeDotenvValue(trimmed.slice(eq + 1));
  }
  return out;
}

/** Serialize a record into a dotenv body (sorted for stable diffs). */
export function serializeDotenv(values: Record<string, string>): string {
  return (
    Object.keys(values)
      .sort()
      .map((k) => `${k}=${escapeDotenvValue(values[k] ?? "")}`)
      .join("\n") + "\n"
  );
}

/**
 * Upsert `updates` into an existing `.dev.vars` body, replacing matching
 * `KEY=` lines in place and appending the rest under a managed header — without
 * disturbing any other lines (comments, non-secret vars written by bootstrap).
 */
export function mergeDevVars(existing: string, updates: Record<string, string>): string {
  const pending = new Map(Object.entries(updates));
  const lines = existing.length > 0 ? existing.split("\n") : [];
  const out: string[] = [];

  for (const line of lines) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=/.exec(line);
    const key = match?.[1];
    if (key !== undefined && pending.has(key)) {
      out.push(`${key}=${escapeDotenvValue(pending.get(key) ?? "")}`);
      pending.delete(key);
    } else {
      out.push(line);
    }
  }

  if (pending.size > 0) {
    if (out.length > 0 && out[out.length - 1]?.trim() !== "") out.push("");
    out.push("# secrets — managed by @si/secrets");
    for (const [key, value] of pending) {
      out.push(`${key}=${escapeDotenvValue(value)}`);
    }
  }

  return out.join("\n").replace(/\n*$/, "\n");
}
