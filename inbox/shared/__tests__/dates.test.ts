// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDetailDate, formatListDate, formatQuotedDate, formatShortDate } from "../dates";

// Fixed "now" so the today/this-year/older branches in formatListDate are
// deterministic. 2024-06-15 is a Saturday.
const NOW = "2024-06-15T12:00:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("formatListDate", () => {
  it("renders a bare time for a date that is today", () => {
    expect(formatListDate(NOW)).toBe("12:00 PM");
  });

  it("renders month + day for a date earlier this year", () => {
    expect(formatListDate("2024-01-05T00:00:00Z")).toBe("Jan 5");
  });

  it("renders month + day + year for a date in a previous year", () => {
    expect(formatListDate("2020-04-15T00:00:00Z")).toBe("Apr 15, 2020");
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatListDate("not-a-date")).toBe("not-a-date");
  });
});

describe("formatDetailDate", () => {
  it("renders weekday, month, day, and time", () => {
    expect(formatDetailDate(NOW)).toBe("Sat, Jun 15, 12:00 PM");
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatDetailDate("garbage")).toBe("garbage");
  });
});

describe("formatShortDate", () => {
  it("renders time only", () => {
    expect(formatShortDate(NOW)).toBe("12:00 PM");
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatShortDate("garbage")).toBe("garbage");
  });
});

describe("formatQuotedDate", () => {
  it("renders the full en-US quoted-reply format regardless of default locale", () => {
    expect(formatQuotedDate(NOW)).toBe("Sat, Jun 15, 2024, 12:00 PM");
  });

  it("returns an empty string for undefined input", () => {
    expect(formatQuotedDate(undefined)).toBe("");
  });

  it("falls back to the raw string for an unparsable date", () => {
    expect(formatQuotedDate("garbage")).toBe("garbage");
  });
});
